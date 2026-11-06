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

# mode values (the exo resists one direction per set; the PT re-orients it between sets)
uint8 MODE_NONE=0
uint8 MODE_FLEXION=1     # set starts relaxed in extension, works by flexing
uint8 MODE_EXTENSION=2   # set starts relaxed in flexion, works by extending

# calib bits (OR-ed). Steps are requested on /wrist/calibrate (std_msgs/String):
#   "neutral", "start", "test_move", "cancel". Changing /wrist/mode clears all bits.
uint8 CAL_NEUTRAL=1      # anatomical neutral set (angle 0)
uint8 CAL_START=2        # start pose recorded (start_deg valid), EMG baseline restarted
uint8 CAL_DIRECTION=4    # test movement done; sensor sign confirmed for this orientation
uint8 CAL_BUSY=8         # a calibration step is running
uint8 CAL_FLIPPED=16     # the test movement found the sensors mounted reversed (sign flipped)
uint8 CAL_FAILED=32      # the last test movement was too small; repeat it

float32 angle_deg        # filtered flex/ext angle from anatomical neutral (+ = flexion)
float32 velocity_dps     # wrist angular velocity (+ = flexion)
float32 emg_flex         # envelope (counts; later %MVC)
float32 emg_ext
float32 emg_flex_thresh  # adaptive onset thresholds, published so they can be plotted
float32 emg_ext_thresh
uint8   phase
uint8   status
uint8   mode
uint8   calib
float32 start_deg        # start pose of the current set (deg from neutral); 0 if not recorded
float32 excursion_deg    # movement from the start pose in the working direction (>= 0)
