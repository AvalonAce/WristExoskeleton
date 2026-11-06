"""Real-time wrist state estimator + movement-phase classifier.

Subscribes /imu/hand, /imu/forearm, /emg/raw (live ESP32 or `ros2 bag play`) and
publishes /wrist/state (wrist_exo_msgs/WristState) once per hand-IMU sample (100 Hz).

Per hand-IMU sample:
  1. wrist angular velocity   w = sign * (hand - forearm) gyro on gyro_axis (sign starts at
                              flex_sign; the per-set test movement may flip it)
  2. wrist angle              complementary filter per IMU, hand - forearm, zeroed at start
                              (signal_processing.WristAngle; filter math from Eric's imu_rpy)
  3. EMG envelope + threshold per channel; baseline adapts only at rest
                              (signal_processing.EmgChannel)
  4. phase classifier         [STUB -> REST, partner's work]

One-direction exo: each set has a mode (flexion or extension) and is calibrated before it
starts (normally by the UI through rosbridge):
  /wrist/mode       std_msgs/String  "flexion" | "extension" | "none"  (clears calibration)
  /wrist/calibrate  std_msgs/String  "neutral" -> "start" -> "test_move"  ("cancel" stops)
Progress is reported in WristState.calib; start_deg and excursion_deg follow from it.
Without the UI the angle auto-zeroes over the first `zero_s` s: hold the wrist at neutral.

Run:  ros2 run wrist_exo wrist_state --ros-args -p flex_sign:=1 -p gyro_axis:=x
"""
import math

import rclpy
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import Imu
from std_msgs.msg import String
from wrist_exo_msgs.msg import EmgBatch, WristState

from wrist_exo.signal_processing import EmgChannel, SetCalibration, WristAngle


def stamp_to_sec(stamp):
    return stamp.sec + stamp.nanosec * 1e-9


class WristStateNode(Node):

    def __init__(self):
        super().__init__('wrist_state')
        self.flex_sign = float(self.declare_parameter('flex_sign', 1).value)
        self.axis = self.declare_parameter('gyro_axis', 'x').value
        if self.axis not in ('x', 'y', 'z'):
            raise ValueError(f'gyro_axis must be x, y or z, got {self.axis!r}')
        # Max age (s) of forearm/EMG data relative to the current hand sample.
        self.stale_s = self.declare_parameter('stale_timeout', 0.1).value
        # Batch mean above this (ADC counts) = channel railed.
        self.sat_level = self.declare_parameter('sat_level', 4000).value
        # Seconds held still at start to zero the angle.
        zero_s = float(self.declare_parameter('zero_s', 1.0).value)
        # EMG onset threshold = resting mean + emg_k * resting sigma.
        emg_k = float(self.declare_parameter('emg_k', 5.0).value)
        # Below this wrist speed (deg/s) the EMG baseline is allowed to adapt.
        self.rest_dps = float(self.declare_parameter('rest_dps', 10.0).value)

        self.emg_k = emg_k
        self.angle = WristAngle(self.axis, self.flex_sign, zero_s, self.stale_s)
        self.cal = SetCalibration(self.angle)
        self._reset_emg()
        self.last_vel_dps = 0.0

        # Latest forearm gyro (rad/s on axis) and its stamp.
        self.forearm_w = 0.0
        self.forearm_t = -math.inf
        # Latest EMG batch, stamp of its LAST sample, and saturation bits.
        self.emg_flex_raw = []
        self.emg_ext_raw = []
        self.emg_t = -math.inf
        self.emg_sat = 0

        self.last_hand_t = None
        self.phase = WristState.REST

        # Reliable publisher; best-effort subscribers (logger, PlotJuggler) are compatible.
        self.pub = self.create_publisher(WristState, 'wrist/state', 10)
        self.create_subscription(Imu, 'imu/hand', self._on_hand, qos_profile_sensor_data)
        self.create_subscription(Imu, 'imu/forearm', self._on_forearm,
                                 qos_profile_sensor_data)
        self.create_subscription(EmgBatch, 'emg/raw', self._on_emg, qos_profile_sensor_data)
        self.create_subscription(String, 'wrist/mode', self._on_mode, 10)
        self.create_subscription(String, 'wrist/calibrate', self._on_calibrate, 10)
        self.get_logger().info(
            f'wrist_state: axis={self.axis} flex_sign={self.flex_sign:+.0f}')

    # ---- set mode + calibration ----------------------------------------------

    def _reset_emg(self):
        self.emg_flex = EmgChannel(k=self.emg_k, rail=self.sat_level)
        self.emg_ext = EmgChannel(k=self.emg_k, rail=self.sat_level)

    def _on_mode(self, msg):
        mode = msg.data.strip().lower()
        before = self.cal.mode
        self.cal.set_mode(mode)
        if self.cal.mode != before:
            self.get_logger().info(f'mode -> {self.cal.mode or "none"} (calibration cleared)')

    def _on_calibrate(self, msg):
        step = msg.data.strip().lower()
        err = self.cal.command(step)
        if err:
            self.get_logger().warn(f'calibrate {step!r} ignored: {err}')
        else:
            self.get_logger().info(f'calibrate: {step}')

    def _calib_bits(self):
        c, b = self.cal, 0
        b |= WristState.CAL_NEUTRAL if c.neutral_done else 0
        b |= WristState.CAL_START if c.start_done else 0
        b |= WristState.CAL_DIRECTION if c.direction_done else 0
        b |= WristState.CAL_BUSY if c.busy else 0
        b |= WristState.CAL_FLIPPED if c.flipped else 0
        b |= WristState.CAL_FAILED if c.failed else 0
        return b

    # ---- input caches -------------------------------------------------------

    def _on_forearm(self, msg):
        self.forearm_w = getattr(msg.angular_velocity, self.axis)
        self.forearm_t = stamp_to_sec(msg.header.stamp)
        a, g = msg.linear_acceleration, msg.angular_velocity
        self.angle.update_forearm(self.forearm_t, (a.x, a.y, a.z), (g.x, g.y, g.z))

    def _on_emg(self, msg):
        n = len(msg.flexor)
        if n == 0:
            return
        self.emg_flex_raw = list(msg.flexor)
        self.emg_ext_raw = list(msg.extensor)
        self.emg_t = stamp_to_sec(msg.header.stamp) + (n - 1) / msg.sample_rate
        sat = 0
        if sum(msg.flexor) / n > self.sat_level:
            sat |= WristState.EMG_FLEX_SAT
        if sum(msg.extensor) / n > self.sat_level:
            sat |= WristState.EMG_EXT_SAT
        self.emg_sat = sat
        # Baseline may adapt only while the wrist is still and the angle is zeroed.
        at_rest = abs(self.last_vel_dps) < self.rest_dps and not self.angle.zeroing
        t0 = stamp_to_sec(msg.header.stamp)
        self.emg_flex.update(t0, list(msg.flexor), at_rest)
        self.emg_ext.update(t0, list(msg.extensor), at_rest)

    # ---- main update (100 Hz, driven by hand IMU) ---------------------------

    def _on_hand(self, msg):
        t = stamp_to_sec(msg.header.stamp)
        dt = 0.0 if self.last_hand_t is None else t - self.last_hand_t
        self.last_hand_t = t
        status = 0

        # 1. Wrist angular velocity. Stamps (not node clock) so bag replay works.
        w = getattr(msg.angular_velocity, self.axis)
        if t - self.forearm_t <= self.stale_s:
            w -= self.forearm_w
        else:
            status |= WristState.FOREARM_STALE
            self.get_logger().warn('forearm IMU stale -> hand-only velocity',
                                   throttle_duration_sec=5.0)
        vel_dps = self.angle.sign * math.degrees(w)  # sign may be flipped by the test movement
        self.last_vel_dps = vel_dps

        if t - self.emg_t > self.stale_s:
            status |= WristState.EMG_STALE
        status |= self.emg_sat

        # 2-4. Stubs until the technique is agreed.
        angle = self._update_angle(vel_dps, msg, dt)
        done = self.cal.step(t, angle)
        if done == 'start':
            self._reset_emg()  # resting baseline for this set's start pose
        if done:
            self.get_logger().info(f'calibration step finished: {done}'
                                   + (' (sensor sign flipped)' if done == 'test_move'
                                      and self.cal.flipped else ''))
        excursion = self.cal.excursion(angle)
        env_f, env_e, thr_f, thr_e = self._update_emg(status)
        self.phase = self._classify(angle, vel_dps, env_f, env_e, thr_f, thr_e, status,
                                    mode=self.cal.mode, excursion=excursion)

        out = WristState()
        out.header.stamp = msg.header.stamp
        out.header.frame_id = 'wrist'
        out.angle_deg = angle
        out.velocity_dps = vel_dps
        out.emg_flex, out.emg_ext = env_f, env_e
        out.emg_flex_thresh, out.emg_ext_thresh = thr_f, thr_e
        out.phase = self.phase
        out.status = status
        modes = {'flexion': WristState.MODE_FLEXION, 'extension': WristState.MODE_EXTENSION}
        out.mode = modes.get(self.cal.mode, WristState.MODE_NONE)
        out.calib = self._calib_bits()
        out.start_deg = self.cal.start_deg if self.cal.start_deg is not None else 0.0
        out.excursion_deg = excursion
        self.pub.publish(out)

    # ---- processing ---------------------------------------------------------

    def _update_angle(self, vel_dps, imu_msg, dt):
        """Wrist angle (deg, + = flexion). 0 while zeroing at startup."""
        a, g = imu_msg.linear_acceleration, imu_msg.angular_velocity
        deg, _ = self.angle.update_hand(
            stamp_to_sec(imu_msg.header.stamp), (a.x, a.y, a.z), (g.x, g.y, g.z))
        return deg

    def _update_emg(self, status):
        """(flex envelope, ext envelope, flex threshold, ext threshold). 0 until data arrives."""
        f, e = self.emg_flex, self.emg_ext
        return (f.env if f.env is not None else 0.0, e.env if e.env is not None else 0.0,
                f.threshold, e.threshold)

    # ---- stub ---------------------------------------------------------------

    def _classify(self, angle, vel_dps, env_f, env_e, thr_f, thr_e, status,
                  mode=None, excursion=0.0):
        """STUB (partner): rule-based FSM. Always REST for now.

        mode: 'flexion' | 'extension' | None. The working muscle is the flexor in flexion sets
        and the extensor in extension sets; excursion is degrees moved from the start pose in
        the working direction. Expected sequence per rep: REST (at start pose) -> ONSET
        (working-muscle EMG above threshold) -> FLEX or EXT (by mode) -> HOLD -> RETURN -> REST.
        """
        return WristState.REST


def main():
    rclpy.init()
    node = WristStateNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
