# A batch of consecutive EMG samples from both MyoWare channels.
# header.stamp = time of the FIRST sample in the batch (MCU clock synced to the agent).
# Sample i was taken at header.stamp + i / sample_rate.
std_msgs/Header header
float32 sample_rate
uint16[] flexor     # raw ADC counts (0-4095), flexor carpi radialis channel
uint16[] extensor   # raw ADC counts (0-4095), extensor carpi radialis channel
