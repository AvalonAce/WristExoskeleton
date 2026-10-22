#!/usr/bin/env bash
# Record the raw sensor topics to a rosbag (run from exo_ws after sourcing install/setup.bash).
ros2 bag record -o "rosbag2_$(date +%Y%m%d_%H%M%S)" /imu/hand /imu/forearm /emg/raw
