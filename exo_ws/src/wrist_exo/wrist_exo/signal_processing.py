"""Signal processing for the wrist exo, kept free of ROS so it can be tested offline.

TiltFilter   per-IMU tilt about one axis (complementary filter). The filter math is Eric's
             (scripts/imu_rpy.py on eric-rpy-tools): accel tilt from atan2, blended with
             integrated gyro, ALPHA = 0.98. Changes: dt comes from message stamps (works under
             bag replay at any rate), and only the axis we need is tracked.
WristAngle   wrist flex/ext angle = hand tilt - forearm tilt about the flex axis, zeroed at
             neutral. Falls back to hand tilt alone if the forearm IMU is stale (valid only
             with the forearm resting still).
EmgChannel   envelope of one EMG channel + adaptive onset threshold (mean + k*sigma of the
             resting envelope; baseline updates only while the caller says the wrist is at rest).
SetCalibration  per-set calibration for the one-direction exo: neutral, start pose, and a
             test movement that learns the sensor sign.

Angles are degrees, + = flexion (after flex_sign). Times are seconds.
"""
import math

ALPHA = 0.98  # gyro weight (Eric's value)


def accel_tilt(ax, ay, az, axis):
    """Tilt (rad) about `axis` from gravity: x roll, y pitch. z is unobservable (None)."""
    if axis == 'x':
        return math.atan2(ay, az)
    if axis == 'y':
        return math.atan2(-ax, math.sqrt(ay * ay + az * az))
    return None


class TiltFilter:
    """Complementary filter for rotation about one sensor axis."""

    def __init__(self, axis='x', alpha=ALPHA, max_dt=0.5):
        self.axis = axis
        self.alpha = alpha
        self.max_dt = max_dt
        self.angle = None  # rad
        self.t = None

    def update(self, t, accel, gyro):
        """accel, gyro: (x, y, z). Returns tilt in rad."""
        g = {'x': gyro[0], 'y': gyro[1], 'z': gyro[2]}[self.axis]
        a = accel_tilt(*accel, self.axis)
        dt = 0.0 if self.t is None else t - self.t
        self.t = t
        if dt <= 0.0 or dt > self.max_dt:  # first sample, out of order, or a gap: don't integrate
            dt = 0.0
        if self.angle is None:
            self.angle = a if a is not None else 0.0
        elif a is None:  # z axis: gyro only, drifts
            self.angle += g * dt
        else:
            self.angle = self.alpha * (self.angle + g * dt) + (1 - self.alpha) * a
        return self.angle


class WristAngle:
    """Hand-minus-forearm tilt about the flex axis, in degrees from anatomical neutral.

    angle = sign * (raw - neutral_raw), where raw is the hand-minus-forearm tilt in sensor
    terms. `sign` maps sensor rotation to + = flexion; it starts at `flex_sign` and can be
    flipped by the direction test (the IMUs may be mounted either way round).
    Until a neutral is set, the first `zero_s` seconds are averaged as neutral (auto-zero), so
    the node works without the UI. `set_neutral()` replaces it with a calibrated value.
    """

    def __init__(self, axis='x', flex_sign=1.0, zero_s=1.0, stale_s=0.1):
        self.hand = TiltFilter(axis)
        self.forearm = TiltFilter(axis)
        self.sign = 1.0 if flex_sign >= 0 else -1.0
        self.zero_s = zero_s
        self.stale_s = stale_s
        self.forearm_t = -math.inf
        self.raw = 0.0  # latest raw tilt, deg
        self.rezero()

    def rezero(self):
        """Forget neutral; auto-zero again over the next `zero_s` seconds."""
        self.neutral_raw = None
        self._zero_sum = 0.0
        self._zero_n = 0
        self._zero_t0 = None

    def set_neutral(self, raw_deg):
        self.neutral_raw = raw_deg

    def flip(self):
        self.sign = -self.sign

    def update_forearm(self, t, accel, gyro):
        self.forearm.update(t, accel, gyro)
        self.forearm_t = t

    def update_hand(self, t, accel, gyro):
        """Returns (angle_deg, forearm_used). Angle is 0 while auto-zeroing."""
        h = self.hand.update(t, accel, gyro)
        forearm_used = self.forearm.angle is not None and t - self.forearm_t <= self.stale_s
        self.raw = math.degrees(h - self.forearm.angle if forearm_used else h)
        if self.neutral_raw is None:
            if self._zero_t0 is None:
                self._zero_t0 = t
            self._zero_sum += self.raw
            self._zero_n += 1
            if t - self._zero_t0 >= self.zero_s:
                self.neutral_raw = self._zero_sum / self._zero_n
            return 0.0, forearm_used
        return self.sign * (self.raw - self.neutral_raw), forearm_used

    @property
    def zeroing(self):
        return self.neutral_raw is None


class EmgChannel:
    """Envelope + baseline-adaptive threshold for one EMG channel.

    Input is a batch of ADC samples (the MyoWare ENV output is already rectified and smoothed,
    so the envelope here is the batch mean through a light EMA). With the RAW output later,
    add high-pass + rectification before `update`.
    Threshold = baseline mean + k * baseline sigma. The baseline (an exponentially weighted
    mean/variance over ~`baseline_s`) only moves while `at_rest` is True and the envelope is
    below threshold, so contractions do not drag the threshold up. Until `warmup_s` of rest has
    been seen, `ready` is False and the threshold is reported as 0.
    """

    def __init__(self, k=5.0, tau_s=0.05, baseline_s=3.0, warmup_s=1.0, min_sigma=5.0,
                 rail=4000.0):
        self.k = k
        self.tau_s = tau_s
        self.baseline_s = baseline_s
        self.warmup_s = warmup_s
        self.min_sigma = min_sigma
        self.rail = rail
        self.env = None
        self.mean = None
        self.var = 0.0
        self.rest_time = 0.0
        self.t = None
        self.saturated = False

    def update(self, t, samples, at_rest):
        """samples: ADC counts for one batch. Returns the envelope."""
        if not samples:
            return self.env if self.env is not None else 0.0
        x = sum(samples) / len(samples)
        self.saturated = x > self.rail
        dt = 0.0 if self.t is None else max(0.0, min(0.5, t - self.t))
        self.t = t
        if self.env is None:
            self.env = x
        else:
            a = dt / (self.tau_s + dt) if dt > 0 else 1.0
            self.env += a * (x - self.env)
        # Adapt only at rest, unsaturated, and below the current threshold: the envelope's
        # decay after a contraction must not leak into the resting baseline.
        if at_rest and not self.saturated and not (self.ready and self.env > self.threshold):
            if self.mean is None:
                self.mean = self.env
            else:
                b = dt / (self.baseline_s + dt) if dt > 0 else 0.0
                d = self.env - self.mean
                self.mean += b * d
                self.var = (1 - b) * (self.var + b * d * d)
            self.rest_time += dt
        return self.env

    @property
    def ready(self):
        return self.mean is not None and self.rest_time >= self.warmup_s

    @property
    def threshold(self):
        if not self.ready:
            return 0.0
        return self.mean + self.k * max(self.min_sigma, math.sqrt(self.var))

    def active(self):
        return self.ready and self.env is not None and self.env > self.threshold


MODE_DIR = {'flexion': 1.0, 'extension': -1.0}


class SetCalibration:
    """Per-set calibration for the one-direction exo. Pure state machine, no ROS.

    The exo resists one direction at a time; the PT re-orients it between sets, which may also
    flip the IMUs. Each set therefore runs, in order:
      neutral    hold the wrist at anatomical neutral (`hold_s`): sets angle 0
      start      relax in the start pose (`hold_s`): records start_deg (the caller also resets
                 the EMG baselines, since this is the resting posture for the set)
      test_move  one slow movement in the working direction: if the angle moved the wrong way,
                 the sensor sign is flipped. Needs `min_move_deg` within `move_timeout_s`.
    Changing the mode invalidates all three (the exo was re-oriented).

    Drive it with `command()` and call `step()` once per hand-IMU sample.
    """

    def __init__(self, angle, hold_s=2.0, min_move_deg=12.0, move_timeout_s=6.0):
        self.angle = angle
        self.hold_s = hold_s
        self.min_move_deg = min_move_deg
        self.move_timeout_s = move_timeout_s
        self.mode = None  # 'flexion' | 'extension' | None
        self.start_deg = None
        self.neutral_done = self.start_done = self.direction_done = False
        self.flipped = self.failed = False
        self._job = None  # (name, t0, accumulator)

    @property
    def busy(self):
        return self._job is not None

    @property
    def direction(self):
        """+1 flexion set, -1 extension set, 0 no mode."""
        return MODE_DIR.get(self.mode, 0.0)

    def set_mode(self, mode):
        """'flexion' / 'extension' / anything else = none. A change invalidates calibration."""
        mode = mode if mode in MODE_DIR else None
        if mode != self.mode:
            self.mode = mode
            self.start_deg = None
            self.neutral_done = self.start_done = self.direction_done = False
            self.flipped = self.failed = False
            self._job = None

    def command(self, name):
        """Start 'neutral', 'start' or 'test_move'; 'cancel' stops a running step.
        Returns an error string if the command cannot run now, else None."""
        if name == 'cancel':
            self._job = None
            return None
        if name not in ('neutral', 'start', 'test_move'):
            return f'unknown calibration step {name!r}'
        if name == 'test_move' and (self.mode is None or not self.start_done):
            return 'test_move needs a mode and the start pose first'
        self.failed = False
        self._job = [name, None, []]
        return None

    def step(self, t, angle_deg):
        """Feed one sample (after WristAngle.update_hand). Returns the name of a step that just
        finished ('neutral', 'start', 'test_move', 'test_move_failed') or None."""
        if self._job is None:
            return None
        name, t0, acc = self._job
        if t0 is None:
            self._job[1] = t0 = t
        if name in ('neutral', 'start'):
            acc.append(self.angle.raw if name == 'neutral' else angle_deg)
            if t - t0 < self.hold_s:
                return None
            mean = sum(acc) / len(acc)
            self._job = None
            if name == 'neutral':
                self.angle.set_neutral(mean)
                self.neutral_done = True
                # start pose and direction are relative to neutral: redo them
                self.start_deg = None
                self.start_done = self.direction_done = False
            else:
                self.start_deg = mean
                self.start_done = True
                self.direction_done = False
            return name
        # test_move: watch the largest displacement from where it began
        if not acc:
            acc.append(angle_deg)
        d = angle_deg - acc[0]
        if len(acc) < 2 or abs(d) > abs(acc[1]):
            acc[1:] = [d]
        best = acc[1]
        if abs(best) >= self.min_move_deg:
            self._job = None
            if (best > 0) != (self.direction > 0):
                self.angle.flip()
                self.start_deg = -self.start_deg  # same pose, new sign
                self.flipped = not self.flipped
            self.direction_done = True
            return 'test_move'
        if t - t0 >= self.move_timeout_s:
            self._job = None
            self.failed = True
            return 'test_move_failed'
        return None

    def excursion(self, angle_deg):
        """Degrees moved from the start pose in the working direction (>= 0); 0 if not ready."""
        if self.mode is None or self.start_deg is None:
            return 0.0
        return max(0.0, self.direction * (angle_deg - self.start_deg))
