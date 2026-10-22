// Hardware + rate configuration for the Adafruit Feather ESP32-S3.
#pragma once

// ---- EMG (MyoWare 2.0) ----
// Must be ADC1 pins: A0-A4 on this Feather are ADC2 and fail once WiFi is on.
// ADC1-capable pins on the Feather S3: A5 (GPIO8), D5, D6, D9, D10.
#define PIN_EMG_FLEXOR    A5
#define PIN_EMG_EXTENSOR  5      // D5

#define EMG_SAMPLE_HZ     1000   // sampling task rate (1 ms FreeRTOS tick)
#define EMG_BATCH         10     // samples per published message -> 100 msgs/s
#define EMG_RING_SIZE     1024   // ~1 s of buffer if the agent stalls

// ---- IMUs (ICM-20948 on STEMMA QT / Wire) ----
// Adafruit breakout default is 0x69; close the AD0 jumper on one board for 0x68.
#define IMU_HAND_ADDR     0x69
#define IMU_FOREARM_ADDR  0x68
#define IMU_PUBLISH_HZ    100
#define I2C_CLOCK_HZ      100000  // scanner found both IMUs at 100 kHz; raise to 400k once stable

// ---- micro-ROS ----
#define NODE_NAME         "wrist_exo_mcu"
#define TOPIC_IMU_HAND    "imu/hand"
#define TOPIC_IMU_FOREARM "imu/forearm"
#define TOPIC_EMG         "emg/raw"
#define FRAME_IMU_HAND    "imu_hand"
#define FRAME_IMU_FOREARM "imu_forearm"
#define FRAME_EMG         "emg"
#define AGENT_PING_MS     1000   // how often to check the agent is still there
#define TIME_SYNC_MS      10000  // re-sync MCU clock to agent clock
