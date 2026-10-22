#!/usr/bin/env bash
# Start the micro-ROS agent for the ESP32 on USB serial.
# Usage: ./scripts/agent.sh [/dev/ttyACM0]
DEV="${1:-/dev/ttyACM0}"
docker run -it --rm -v /dev:/dev --privileged --net=host \
  microros/micro-ros-agent:jazzy serial --dev "$DEV" -b 115200 -v4
