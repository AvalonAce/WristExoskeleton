#!/usr/bin/env python3
"""Publish roll/pitch/yaw (degrees) for /imu/hand and /imu/forearm.

Output topics: /imu/hand/rpy, /imu/forearm/rpy  (geometry_msgs/Vector3Stamped)
  vector.x = roll, vector.y = pitch, vector.z = yaw

If the IMU message has a valid orientation quaternion it is converted.
Otherwise roll/pitch come from a complementary filter (accel + gyro) and
yaw is the integrated gyro z (it drifts; no magnetometer).
"""
import math

import rclpy
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import Imu
from geometry_msgs.msg import Vector3Stamped

ALPHA = 0.98  # gyro weight in the complementary filter


def quat_to_rpy(x, y, z, w):
    roll = math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y))
    pitch = math.asin(max(-1.0, min(1.0, 2 * (w * y - z * x))))
    yaw = math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
    return roll, pitch, yaw


class Rpy(Node):
    def __init__(self):
        super().__init__('imu_rpy')
        self.state = {}
        self.pubs = {}
        for n in ('hand', 'forearm'):
            self.pubs[n] = self.create_publisher(
                Vector3Stamped, '/imu/%s/rpy' % n, 10)
            self.create_subscription(
                Imu, '/imu/%s' % n,
                lambda m, n=n: self.cb(n, m),
                qos_profile_sensor_data)
        self.get_logger().info('imu_rpy running: publishing /imu/*/rpy')

    def cb(self, name, m):
        now = self.get_clock().now()
        q = m.orientation
        norm = math.sqrt(q.x ** 2 + q.y ** 2 + q.z ** 2 + q.w ** 2)
        identity = (q.w == 1.0 and q.x == 0.0 and q.y == 0.0 and q.z == 0.0)
        provided = (m.orientation_covariance[0] != -1.0
                    and norm > 0.9 and not identity)

        if provided:
            r, p, y = quat_to_rpy(q.x, q.y, q.z, q.w)
        else:
            a, g = m.linear_acceleration, m.angular_velocity
            s = self.state.setdefault(
                name, {'r': 0.0, 'p': 0.0, 'y': 0.0, 't': now, 'init': False})
            dt = (now - s['t']).nanoseconds * 1e-9
            s['t'] = now
            if dt <= 0.0 or dt > 0.5:
                dt = 0.0
            ar = math.atan2(a.y, a.z)
            ap = math.atan2(-a.x, math.sqrt(a.y ** 2 + a.z ** 2))
            if not s['init']:
                s['r'], s['p'], s['init'] = ar, ap, True
            else:
                s['r'] = ALPHA * (s['r'] + g.x * dt) + (1 - ALPHA) * ar
                s['p'] = ALPHA * (s['p'] + g.y * dt) + (1 - ALPHA) * ap
            s['y'] += g.z * dt
            r, p, y = s['r'], s['p'], s['y']

        out = Vector3Stamped()
        out.header.stamp = now.to_msg()
        out.header.frame_id = name
        out.vector.x = math.degrees(r)
        out.vector.y = math.degrees(p)
        out.vector.z = math.degrees(y)
        self.pubs[name].publish(out)


def main():
    rclpy.init()
    node = Rpy()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    node.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()
