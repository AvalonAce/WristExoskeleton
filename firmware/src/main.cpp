// Wrist exo sensor node (Adafruit Feather ESP32-S3, micro-ROS over USB serial).
//
// Publishes raw sensor data:
//   /imu/hand, /imu/forearm  sensor_msgs/Imu          @ IMU_PUBLISH_HZ
//   /emg/raw                 wrist_exo_msgs/EmgBatch  (EMG_SAMPLE_HZ, EMG_BATCH per msg)
//
// EMG is sampled by a FreeRTOS task on core 0 into a ring buffer so network
// stalls don't create gaps; loop() (core 1) reads IMUs and publishes.
// Built-in LED: on = connected to the micro-ROS agent.

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_ICM20X.h>
#include <Adafruit_ICM20948.h>
#include <Adafruit_Sensor.h>

#include <micro_ros_platformio.h>
#include <rcl/rcl.h>
#include <rclc/rclc.h>
#include <rmw_microros/rmw_microros.h>
#include <rosidl_runtime_c/string_functions.h>
#include <rosidl_runtime_c/primitives_sequence_functions.h>

#include <sensor_msgs/msg/imu.h>
#include <wrist_exo_msgs/msg/emg_batch.h>

#include "config.h"

#if !defined(MICRO_ROS_TRANSPORT_ARDUINO_SERIAL)
#error "This firmware expects board_microros_transport = serial"
#endif

// ---------------------------------------------------------------- EMG ring
struct EmgSample {
  uint32_t t_us;
  uint16_t flexor;
  uint16_t extensor;
};

static EmgSample emg_ring[EMG_RING_SIZE];
static volatile uint32_t emg_head = 0;  // next write index (total count)
static volatile uint32_t emg_tail = 0;  // next read index (total count)
static portMUX_TYPE emg_mux = portMUX_INITIALIZER_UNLOCKED;

static void emgTask(void *) {
  const TickType_t period = pdMS_TO_TICKS(1000 / EMG_SAMPLE_HZ);
  TickType_t last = xTaskGetTickCount();
  for (;;) {
    vTaskDelayUntil(&last, period);
    EmgSample s;
    s.t_us = micros();
    s.flexor = analogRead(PIN_EMG_FLEXOR);
    s.extensor = analogRead(PIN_EMG_EXTENSOR);
    portENTER_CRITICAL(&emg_mux);
    emg_ring[emg_head % EMG_RING_SIZE] = s;
    emg_head++;
    if (emg_head - emg_tail > EMG_RING_SIZE) {
      emg_tail = emg_head - EMG_RING_SIZE;  // overflow: drop oldest
    }
    portEXIT_CRITICAL(&emg_mux);
  }
}

static uint32_t emgAvailable() {
  portENTER_CRITICAL(&emg_mux);
  uint32_t n = emg_head - emg_tail;
  portEXIT_CRITICAL(&emg_mux);
  return n;
}

// ---------------------------------------------------------------- IMUs
static Adafruit_ICM20948 imu_hand;
static Adafruit_ICM20948 imu_forearm;
static bool imu_hand_ok = false;
static bool imu_forearm_ok = false;

static bool setupImu(Adafruit_ICM20948 &imu, uint8_t addr) {
  if (!imu.begin_I2C(addr, &Wire)) return false;
  imu.setAccelRange(ICM20948_ACCEL_RANGE_4_G);
  imu.setGyroRange(ICM20948_GYRO_RANGE_500_DPS);
  // ODR = 1125 Hz / (1 + div). div = 1 -> 562.5 Hz, faster than we read.
  imu.setAccelRateDivisor(1);
  imu.setGyroRateDivisor(1);
  return true;
}

// ---------------------------------------------------------------- micro-ROS
enum AgentState { WAITING_AGENT, AGENT_AVAILABLE, AGENT_CONNECTED, AGENT_DISCONNECTED };
static AgentState state = WAITING_AGENT;

static rclc_support_t support;
static rcl_allocator_t allocator;
static rcl_node_t node;
static rcl_publisher_t pub_imu_hand;
static rcl_publisher_t pub_imu_forearm;
static rcl_publisher_t pub_emg;

static sensor_msgs__msg__Imu msg_imu_hand;
static sensor_msgs__msg__Imu msg_imu_forearm;
static wrist_exo_msgs__msg__EmgBatch msg_emg;

#define RCCHECK(fn) { if ((fn) != RCL_RET_OK) { return false; } }
// Best-effort calls whose result we deliberately ignore (silences warn_unused_result).
#define RCSOFT(fn) { rcl_ret_t rc_ = (fn); (void)rc_; }

static void initImuMsg(sensor_msgs__msg__Imu &m, const char *frame) {
  sensor_msgs__msg__Imu__init(&m);
  rosidl_runtime_c__String__assign(&m.header.frame_id, frame);
  m.orientation_covariance[0] = -1.0;  // no orientation estimate (raw data)
}

static void initMessages() {
  initImuMsg(msg_imu_hand, FRAME_IMU_HAND);
  initImuMsg(msg_imu_forearm, FRAME_IMU_FOREARM);
  wrist_exo_msgs__msg__EmgBatch__init(&msg_emg);
  rosidl_runtime_c__String__assign(&msg_emg.header.frame_id, FRAME_EMG);
  msg_emg.sample_rate = (float)EMG_SAMPLE_HZ;
  rosidl_runtime_c__uint16__Sequence__init(&msg_emg.flexor, EMG_BATCH);
  rosidl_runtime_c__uint16__Sequence__init(&msg_emg.extensor, EMG_BATCH);
}

static void stampFromEpochNs(builtin_interfaces__msg__Time &t, int64_t ns) {
  t.sec = (int32_t)(ns / 1000000000LL);
  t.nanosec = (uint32_t)(ns % 1000000000LL);
}

static bool createEntities() {
  allocator = rcl_get_default_allocator();
  RCCHECK(rclc_support_init(&support, 0, NULL, &allocator));
  RCCHECK(rclc_node_init_default(&node, NODE_NAME, "", &support));
  if (imu_hand_ok) {
    RCCHECK(rclc_publisher_init_best_effort(&pub_imu_hand, &node,
        ROSIDL_GET_MSG_TYPE_SUPPORT(sensor_msgs, msg, Imu), TOPIC_IMU_HAND));
  }
  if (imu_forearm_ok) {
    RCCHECK(rclc_publisher_init_best_effort(&pub_imu_forearm, &node,
        ROSIDL_GET_MSG_TYPE_SUPPORT(sensor_msgs, msg, Imu), TOPIC_IMU_FOREARM));
  }
  RCCHECK(rclc_publisher_init_best_effort(&pub_emg, &node,
      ROSIDL_GET_MSG_TYPE_SUPPORT(wrist_exo_msgs, msg, EmgBatch), TOPIC_EMG));
  rmw_uros_sync_session(1000);  // align MCU clock with the agent's clock
  return true;
}

static void destroyEntities() {
  rmw_context_t *ctx = rcl_context_get_rmw_context(&support.context);
  (void)rmw_uros_set_context_entity_destroy_session_timeout(ctx, 0);
  if (imu_hand_ok) RCSOFT(rcl_publisher_fini(&pub_imu_hand, &node));
  if (imu_forearm_ok) RCSOFT(rcl_publisher_fini(&pub_imu_forearm, &node));
  RCSOFT(rcl_publisher_fini(&pub_emg, &node));
  RCSOFT(rcl_node_fini(&node));
  RCSOFT(rclc_support_fini(&support));
}

// ---------------------------------------------------------------- publishing
static void readAndPublishImu(Adafruit_ICM20948 &imu, sensor_msgs__msg__Imu &m,
                              rcl_publisher_t &pub) {
  sensors_event_t accel, gyro, temp, mag;
  imu.getEvent(&accel, &gyro, &temp, &mag);
  stampFromEpochNs(m.header.stamp, rmw_uros_epoch_nanos());
  m.linear_acceleration.x = accel.acceleration.x;  // m/s^2
  m.linear_acceleration.y = accel.acceleration.y;
  m.linear_acceleration.z = accel.acceleration.z;
  m.angular_velocity.x = gyro.gyro.x;               // rad/s
  m.angular_velocity.y = gyro.gyro.y;
  m.angular_velocity.z = gyro.gyro.z;
  RCSOFT(rcl_publish(&pub, &m, NULL));
}

static void publishEmgBatches() {
  while (emgAvailable() >= EMG_BATCH) {
    uint32_t t_first_us = 0;
    portENTER_CRITICAL(&emg_mux);
    for (size_t i = 0; i < EMG_BATCH; i++) {
      const EmgSample &s = emg_ring[(emg_tail + i) % EMG_RING_SIZE];
      if (i == 0) t_first_us = s.t_us;
      msg_emg.flexor.data[i] = s.flexor;
      msg_emg.extensor.data[i] = s.extensor;
    }
    emg_tail += EMG_BATCH;
    portEXIT_CRITICAL(&emg_mux);

    msg_emg.flexor.size = EMG_BATCH;
    msg_emg.extensor.size = EMG_BATCH;
    // Convert the first sample's micros() time into synced epoch time.
    int64_t age_ns = (int64_t)(uint32_t)(micros() - t_first_us) * 1000LL;
    stampFromEpochNs(msg_emg.header.stamp, rmw_uros_epoch_nanos() - age_ns);
    RCSOFT(rcl_publish(&pub_emg, &msg_emg, NULL));
  }
}

static void runConnected() {
  static uint32_t next_imu_us = micros();
  static uint32_t last_sync_ms = millis();

  if ((int32_t)(micros() - next_imu_us) >= 0) {
    next_imu_us += 1000000UL / IMU_PUBLISH_HZ;
    if (imu_hand_ok) readAndPublishImu(imu_hand, msg_imu_hand, pub_imu_hand);
    if (imu_forearm_ok) readAndPublishImu(imu_forearm, msg_imu_forearm, pub_imu_forearm);
  }
  publishEmgBatches();

  if (millis() - last_sync_ms > TIME_SYNC_MS) {
    last_sync_ms = millis();
    rmw_uros_sync_session(100);
  }
}

// ---------------------------------------------------------------- setup/loop
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

  Serial.begin(115200);
  set_microros_serial_transports(Serial);

#if defined(PIN_I2C_POWER)
  pinMode(PIN_I2C_POWER, OUTPUT);  // powers the STEMMA QT port on the Feather
  digitalWrite(PIN_I2C_POWER, HIGH);
#endif
  delay(100);  // ICM-20948 needs >=11 ms after power-up before registers respond
  Wire.begin();
  Wire.setClock(I2C_CLOCK_HZ);
  imu_hand_ok = setupImu(imu_hand, IMU_HAND_ADDR);
  imu_forearm_ok = setupImu(imu_forearm, IMU_FOREARM_ADDR);

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);  // ~0-3.1 V input range
  xTaskCreatePinnedToCore(emgTask, "emg", 4096, NULL, 5, NULL, 0);

  initMessages();
  state = WAITING_AGENT;
}

void loop() {
  static uint32_t last_ping_ms = 0;
  switch (state) {
    case WAITING_AGENT:
      if (millis() - last_ping_ms > 500) {
        last_ping_ms = millis();
        if (rmw_uros_ping_agent(100, 1) == RMW_RET_OK) state = AGENT_AVAILABLE;
      }
      break;
    case AGENT_AVAILABLE:
      if (createEntities()) {
        state = AGENT_CONNECTED;
        digitalWrite(LED_BUILTIN, HIGH);
      } else {
        destroyEntities();
        state = WAITING_AGENT;
      }
      break;
    case AGENT_CONNECTED:
      if (millis() - last_ping_ms > AGENT_PING_MS) {
        last_ping_ms = millis();
        if (rmw_uros_ping_agent(100, 1) != RMW_RET_OK) {
          state = AGENT_DISCONNECTED;
          break;
        }
      }
      runConnected();
      break;
    case AGENT_DISCONNECTED:
      destroyEntities();
      digitalWrite(LED_BUILTIN, LOW);
      state = WAITING_AGENT;
      break;
  }
}
