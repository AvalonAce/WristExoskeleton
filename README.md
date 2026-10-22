# WristExoskeleton

Wearable wrist rehab exoskeleton: ESP32-S3 (micro-ROS) sensor node + ROS 2 Jazzy workspace.

```
firmware/          PlatformIO project (Adafruit Feather ESP32-S3, micro-ROS over USB serial)
exo_ws/src/
  wrist_exo_msgs/  custom messages (EmgBatch), also built into the firmware via firmware/extra_packages
  wrist_exo/       ROS 2 Python nodes (csv_logger)
scripts/           agent + recording helpers
```

## Topics (from the ESP32)

| Topic | Type | Rate |
|---|---|---|
| `/imu/hand`, `/imu/forearm` | `sensor_msgs/Imu` (raw accel m/s², gyro rad/s) | 100 Hz |
| `/emg/raw` | `wrist_exo_msgs/EmgBatch` (10 samples/msg, raw ADC 0–4095) | 1 kHz samples |

## Wiring (Feather ESP32-S3)

| Part | Pin |
|---|---|
| MyoWare flexor (ENV or RAW) | A5 |
| MyoWare extensor (ENV or RAW) | D5 |
| MyoWare +/− | 3V3 / GND |
| ICM-20948 hand (0x69, default) | STEMMA QT |
| ICM-20948 forearm (0x68, AD0 jumper closed) | STEMMA QT (daisy-chained) |

Use ADC1 pins only (A5, D5, D6, D9, D10); A0–A4 are ADC2 and fail with WiFi on.

## Quick start (Ubuntu 24.04 + Jazzy, board plugged into this machine)

```bash
# 1. ROS workspace
cd exo_ws && colcon build && source install/setup.bash

# 2. Firmware (first build compiles micro-ROS: several minutes)
cd ../firmware && pio run -t upload

# 3. Agent (separate terminal) -- built-in LED turns on when connected
./scripts/agent.sh /dev/ttyACM0

# 4. Check data
ros2 topic list
ros2 topic hz /imu/hand
ros2 topic echo /emg/raw --qos-reliability best_effort

# 5. Log to CSV
ros2 run wrist_exo csv_logger --ros-args -p out_dir:=~/exo_runs
```

After changing `EmgBatch.msg`, rebuild micro-ROS: `pio run -t clean_microros && pio run`.
