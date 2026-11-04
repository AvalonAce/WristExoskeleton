import math, rclpy
from rclpy.node import Node
from sensor_msgs.msg import Imu

class Fake(Node):
    def __init__(self):
        super().__init__('fake_imu')
        self.pubs = {n: self.create_publisher(Imu, f'/imu/{n}', 10) for n in ('hand', 'forearm')}
        self.t = 0.0
        self.create_timer(0.01, self.tick)
    def tick(self):
        self.t += 0.01
        for i, p in enumerate(self.pubs.values()):
            m = Imu()
            m.header.stamp = self.get_clock().now().to_msg()
            m.header.frame_id = 'imu'
            m.linear_acceleration.x = math.sin(2 * math.pi * 0.5 * self.t + i)
            m.linear_acceleration.y = math.cos(2 * math.pi * 0.5 * self.t + i)
            m.linear_acceleration.z = 9.81
            m.angular_velocity.z = math.sin(2 * math.pi * 0.2 * self.t)
            m.orientation.w = 1.0
            p.publish(m)

rclpy.init()
rclpy.spin(Fake())
