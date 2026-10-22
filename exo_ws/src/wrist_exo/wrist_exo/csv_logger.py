"""Log raw IMU + EMG topics from the ESP32 to CSV files.

Run:  ros2 run wrist_exo csv_logger --ros-args -p out_dir:=~/exo_runs
Writes <out_dir>/<timestamp>/{imu_hand,imu_forearm,emg}.csv. Ctrl+C to stop.
"""
import csv
import os
import time

import rclpy
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import Imu
from wrist_exo_msgs.msg import EmgBatch


def stamp_to_sec(stamp):
    return stamp.sec + stamp.nanosec * 1e-9


class CsvLogger(Node):

    def __init__(self):
        super().__init__('csv_logger')
        out_dir = os.path.expanduser(
            self.declare_parameter('out_dir', '~/exo_runs').value)
        self.run_dir = os.path.join(out_dir, time.strftime('%Y%m%d_%H%M%S'))
        os.makedirs(self.run_dir, exist_ok=True)

        self.files = []
        imu_header = ['t', 'ax', 'ay', 'az', 'gx', 'gy', 'gz']
        self.imu_hand = self._open('imu_hand.csv', imu_header)
        self.imu_forearm = self._open('imu_forearm.csv', imu_header)
        self.emg = self._open('emg.csv', ['t', 'flexor', 'extensor'])
        self.counts = {'imu/hand': 0, 'imu/forearm': 0, 'emg/raw': 0}

        self.create_subscription(
            Imu, 'imu/hand',
            lambda m: self._on_imu(m, self.imu_hand, 'imu/hand'),
            qos_profile_sensor_data)
        self.create_subscription(
            Imu, 'imu/forearm',
            lambda m: self._on_imu(m, self.imu_forearm, 'imu/forearm'),
            qos_profile_sensor_data)
        self.create_subscription(
            EmgBatch, 'emg/raw', self._on_emg, qos_profile_sensor_data)
        self.create_timer(2.0, self._report)
        self.get_logger().info(f'Logging to {self.run_dir}')

    def _open(self, name, header):
        f = open(os.path.join(self.run_dir, name), 'w', newline='')
        w = csv.writer(f)
        w.writerow(header)
        self.files.append(f)
        return w

    def _on_imu(self, msg, writer, key):
        a, g = msg.linear_acceleration, msg.angular_velocity
        writer.writerow([f'{stamp_to_sec(msg.header.stamp):.6f}',
                         a.x, a.y, a.z, g.x, g.y, g.z])
        self.counts[key] += 1

    def _on_emg(self, msg):
        t0 = stamp_to_sec(msg.header.stamp)
        dt = 1.0 / msg.sample_rate
        for i, (f, e) in enumerate(zip(msg.flexor, msg.extensor)):
            self.emg.writerow([f'{t0 + i * dt:.6f}', f, e])
        self.counts['emg/raw'] += len(msg.flexor)

    def _report(self):
        rates = ', '.join(f'{k}: {v / 2.0:.0f}/s' for k, v in self.counts.items())
        self.get_logger().info(rates)
        for k in self.counts:
            self.counts[k] = 0

    def close(self):
        for f in self.files:
            f.close()


def main():
    rclpy.init()
    node = CsvLogger()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.close()
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
