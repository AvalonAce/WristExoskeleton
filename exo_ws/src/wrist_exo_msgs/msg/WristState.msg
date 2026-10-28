# Real-time wrist state from the wrist_state node. Host-only (firmware never uses it).
# One message per hand-IMU sample (100 Hz). header.stamp = stamp of that hand-IMU sample.
std_msgs/Header header

# phase values
uint8 REST=0
uint8 ONSET=1
uint8 FLEX=2
uint8 EXT=3
uint8 HOLD=4
uint8 RETURN=5

# status bits (OR-ed together; 0 = all healthy)
uint8 FOREARM_STALE=1   # no recent forearm IMU -> velocity is hand-only (includes forearm motion)
uint8 EMG_STALE=2       # no recent EMG batch
uint8 EMG_FLEX_SAT=4    # flexor channel near ADC rail -> unusable
uint8 EMG_EXT_SAT=8     # extensor channel near ADC rail -> unusable

float32 angle_deg        # filtered flex/ext angle (+ = flexion)
float32 velocity_dps     # wrist angular velocity (+ = flexion)
float32 emg_flex         # envelope (counts; later %MVC)
float32 emg_ext
float32 emg_flex_thresh  # adaptive onset thresholds, published so they can be plotted
float32 emg_ext_thresh
uint8   phase
uint8   status
