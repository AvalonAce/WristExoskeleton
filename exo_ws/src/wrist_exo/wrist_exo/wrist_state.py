"""Real-time wrist state estimator + movement-phase classifier.

Subscribes /imu/hand, /imu/forearm, /emg/raw (live ESP32 or `ros2 bag play`) and
publishes /wrist/state (wrist_exo_msgs/WristState) once per hand-IMU sample (100 Hz).

Per hand-IMU sample:
  1. wrist angular velocity   w = flex_sign * (hand - forearm) gyro on gyro_axis   [done]
  2. angle filter                                                                    [STUB]
  3. EMG envelope + adaptive threshold                                               [STUB]
  4. phase classifier (rule-based FSM)                                               [STUB -> REST]

Run:  ros2 run wrist_exo wrist_state --ros-args -p flex_sign:=1 -p gyro_axis:=x
"""
import math

import rclpy
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import Imu
from wrist_exo_msgs.msg import EmgBatch, WristState

NAN = float('nan')


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
        self.get_logger().info(
            f'wrist_state: axis={self.axis} flex_sign={self.flex_sign:+.0f}')

    # ---- input caches -------------------------------------------------------

    def _on_forearm(self, msg):
        self.forearm_w = getattr(msg.angular_velocity, self.axis)
        self.forearm_t = stamp_to_sec(msg.header.stamp)

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
        vel_dps = self.flex_sign * math.degrees(w)

        if t - self.emg_t > self.stale_s:
            status |= WristState.EMG_STALE
        status |= self.emg_sat

        # 2-4. Stubs until the technique is agreed.
        angle = self._update_angle(vel_dps, msg, dt)
        env_f, env_e, thr_f, thr_e = self._update_emg(status)
        self.phase = self._classify(angle, vel_dps, env_f, env_e, thr_f, thr_e, status)

        out = WristState()
        out.header.stamp = msg.header.stamp
        out.header.frame_id = 'wrist'
        out.angle_deg = angle
        out.velocity_dps = vel_dps
        out.emg_flex, out.emg_ext = env_f, env_e
        out.emg_flex_thresh, out.emg_ext_thresh = thr_f, thr_e
        out.phase = self.phase
        out.status = status
        self.pub.publish(out)

    # ---- stubs --------------------------------------------------------------

    def _update_angle(self, vel_dps, imu_msg, dt):
        """STUB: angle filter (complementary / Kalman). Returns NaN for now."""
        return NAN

    def _update_emg(self, status):
        """STUB: envelope + baseline-adaptive threshold. Returns NaNs for now."""
        return NAN, NAN, NAN, NAN

    def _classify(self, angle, vel_dps, env_f, env_e, thr_f, thr_e, status):
        """STUB: rule-based FSM. Always REST for now."""
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
