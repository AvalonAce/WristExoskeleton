# WristExoskeleton

Wearable wrist rehab exoskeleton (Duke, Experimental Design, Fall 2026).
Senses 2 DoF (flexion/extension, radial/ulnar) with two IMUs and two surface-EMG
sensors; later actuates flexion/extension with adjustable resistance.
Research question: does fusing IMU + EMG detect wrist-movement onset earlier than
either alone, using rule-based signal processing (no ML).

**Branch for current work: `micro-ros-sensors`.**

---

## 1. What is here

```
firmware/                 PlatformIO project for the Adafruit Feather ESP32-S3 (env: feather_s3)
  platformio.ini          espressif32@6.9.0 PINNED (micro_ros_platformio breaks on >=7)
  include/config.h        pins, I2C addresses, rates, topic names, IMU health thresholds
  src/main.cpp            micro-ROS node: EMG @ 1 kHz, 2x IMU @ 100 Hz, self-healing IMU init
  extra_packages/wrist_exo_msgs -> ../../exo_ws/src/wrist_exo_msgs   (symlink, see §4)
exo_ws/src/
  wrist_exo_msgs/         EmgBatch.msg (header, sample_rate, uint16[] flexor, uint16[] extensor)
  wrist_exo/              ROS 2 Python package: csv_logger node
analysis/plot_run.py      offline plots: time series, per-rep onset lag, EMG-vs-gyro correlation
scripts/agent.sh          start the micro-ROS agent (Docker) on a serial port
scripts/record_bag.sh     rosbag the three sensor topics
tools/i2c_scanner/        standalone PlatformIO sketch: prints I2C addresses (debug only)
```

### Functionality today

| Piece | Status |
|---|---|
| ESP32 firmware: EMG 1 kHz x2, IMU 100 Hz x2, micro-ROS over USB serial | working |
| IMU self-healing: detects frozen/implausible reads, re-inits every 1 s; both `/imu/*` topics always exist | working |
| `csv_logger`: writes a timestamped run folder, `-p label:=`, Enter key = event marker | working |
| `plot_run.py`: 3 figures + onset table from a run folder | working, thresholds need tuning on real data |
| Ground-truth encoders (AS5600), actuator, WiFi transport | not started |
| EMG RAW output + software envelope (replaces MyoWare ENV, ~44 ms lag) | planned |

### Topics published by the ESP32

| Topic | Type | Rate | Notes |
|---|---|---|---|
| `/imu/hand`, `/imu/forearm` | `sensor_msgs/Imu` | 100 Hz | raw accel m/s², gyro rad/s, no orientation |
| `/emg/raw` | `wrist_exo_msgs/EmgBatch` | 100 msg/s | 10 samples/msg = 1 kHz, raw 12-bit ADC counts |

All stamps are in the laptop's wall clock: the ESP32 syncs its clock to the agent
(NTP-style) on connect and every 10 s. EMG batch `header.stamp` is the time of
sample 0; sample *i* is at `stamp + i / sample_rate`.

---

## 2. Hardware and wiring (Feather ESP32-S3, 2 MB PSRAM)

| Part | Connection |
|---|---|
| MyoWare 2.0 #1 ("flexor", EMG ch. 1) | VIN→3V, GND→GND, **ENV→A5** (GPIO8, ADC1) |
| MyoWare 2.0 #2 ("extensor", EMG ch. 2) | VIN→3V, GND→GND, **ENV→D5** (GPIO5, ADC1) |
| ICM-20948 "hand" | STEMMA QT, address **0x69** (default) |
| ICM-20948 "forearm" | STEMMA QT daisy-chained, **SDO/ADR → GND → 0x68** |

- EMG must stay on **ADC1** pins (A5, D5, D6, D9, D10). A0–A4 are ADC2 and stop working when WiFi is on.
- The board enumerates on USB as an **Adafruit** device (TinyUSB CDC):
  Linux `/dev/ttyACM0` / `/dev/serial/by-id/usb-Adafruit_Feather_ESP32-S3_*-if00`.
  If you only see `Espressif USB JTAG/serial debug unit`, the board is in the
  bootloader: press **RESET**.
- Verify the I2C bus with `tools/i2c_scanner` if an IMU is missing: expect `0x36` (battery monitor), `0x68`, `0x69`.
- Safety: laptop on battery (charger unplugged) whenever electrodes are on skin.

---

## 3. Setup

### 3a. Linux (Ubuntu 24.04) — the reference setup

```bash
sudo apt update && sudo apt install -y git docker.io python3-venv python3-pip
# ROS 2 Jazzy (ros-jazzy-ros-base + colcon is enough):
#   https://docs.ros.org/en/jazzy/Installation/Ubuntu-Install-Debs.html
# PlatformIO core (the apt package is broken, use the official installer):
curl -fsSL https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py -o /tmp/get-platformio.py
python3 /tmp/get-platformio.py
echo 'export PATH=$PATH:$HOME/.platformio/penv/bin' >> ~/.bashrc && source ~/.bashrc

git clone -b micro-ros-sensors https://github.com/AvalonAce/WristExoskeleton.git
cd WristExoskeleton
pip install --user pandas matplotlib          # for analysis/plot_run.py
sudo usermod -aG dialout,docker $USER         # serial port + docker without sudo; log out/in
```

If you use conda: **deactivate it** before `colcon build` or you get
`ModuleNotFoundError: No module named 'em'`.

### 3b. Windows — use WSL2 (do not try native Windows ROS 2)

Everything (ROS 2, colcon, Docker agent, PlatformIO) runs inside an Ubuntu 24.04
WSL2 VM exactly as on Linux. The only Windows-specific step is handing the
ESP32's USB port to WSL with `usbipd-win`.

**One-time, in an admin PowerShell:**

```powershell
wsl --install -d Ubuntu-24.04        # reboot if asked, then set a username/password
winget install --interactive --exact dorssel.usbipd-win
```

**One-time, inside Ubuntu (open "Ubuntu 24.04" from the Start menu):**

Run the whole Linux block from §3a. Two WSL notes:

- Docker: `sudo apt install docker.io` works in WSL2 (Ubuntu 24.04 uses systemd).
  If `docker ps` says the daemon is not running: `sudo service docker start`.
  Docker Desktop for Windows with WSL integration also works; either, not both.
- Clone the repo **inside the Linux filesystem** (`~/WristExoskeleton`), not under
  `/mnt/c/...`. Builds on `/mnt/c` are 10x slower and the symlink in §4 breaks.

**Every time you plug the board in (admin PowerShell):**

```powershell
usbipd list                                  # find the Feather: VID 239A (Adafruit) or 303A (Espressif = bootloader)
usbipd bind --busid <BUSID>                  # first time only for this port
usbipd attach --wsl --busid <BUSID>          # repeat after every unplug / RESET / firmware upload
```

Then in Ubuntu `ls /dev/ttyACM*` shows the board. `usbipd detach --busid <BUSID>`
gives it back to Windows.

**Flashing from WSL:** `pio run -t upload` toggles the port at 1200 bps, which
re-enumerates the board and detaches it from WSL mid-upload. Two workarounds:

1. Upload from Windows instead: install VS Code + the PlatformIO extension on
   Windows, open the `firmware/` folder from `\\wsl$\Ubuntu-24.04\home\<user>\WristExoskeleton\firmware`,
   click Upload. Then `usbipd attach` and run the agent in WSL.
2. Or hold **BOOT**, tap **RESET**, release BOOT (manual bootloader), `usbipd attach`
   the 303A device, `pio run -t upload`, press RESET, `usbipd attach` the 239A device.

Option 1 is less fiddly day-to-day.

**Plotting from Windows Python** (no WSL needed): `pip install pandas matplotlib`,
then `python analysis\plot_run.py <run folder> --save`. Run folders written in WSL
are reachable from Windows at `\\wsl$\Ubuntu-24.04\home\<user>\exo_runs`.

---

## 4. Build

### ROS 2 workspace

```bash
cd exo_ws
source /opt/ros/jazzy/setup.bash
colcon build
source install/setup.bash
```

Rebuild after editing `csv_logger.py` or `EmgBatch.msg`.

### Firmware (first build compiles micro-ROS: several minutes)

```bash
cd firmware            # ALWAYS from firmware/ — the repo root is not a PlatformIO project
pio run                # build
pio run -t upload      # flash (see WSL note above)
```

`firmware/extra_packages/wrist_exo_msgs` is a **symlink** to the ROS message
package so the custom message is compiled into libmicroros. Git on Windows checks
out symlinks as plain text files unless Developer Mode is on and
`git config --global core.symlinks true` is set *before* cloning. Inside WSL this
is not an issue. If the symlink is broken, recreate it:

```bash
cd firmware/extra_packages && rm -f wrist_exo_msgs && ln -s ../../exo_ws/src/wrist_exo_msgs wrist_exo_msgs
```

After changing `EmgBatch.msg`: `pio run -t clean_microros && pio run`.

---

## 5. Run

Three terminals.

**A — agent** (red LED on the Feather turns on when connected):

```bash
./scripts/agent.sh /dev/ttyACM0            # or the /dev/serial/by-id/usb-Adafruit_* path
```

The agent prints `running... fd: 3` and then nothing until the board connects;
expect `session established` and `create_publisher` x3 within ~1 s. If nothing
appears: press RESET; check `pio device monitor -b 115200` shows binary garbage
every 0.5 s (= firmware pinging) rather than `Scanning...` (= scanner sketch
flashed) or silence (= wrong port / bootloader).

**B — check data:**

```bash
source /opt/ros/jazzy/setup.bash && source exo_ws/install/setup.bash
ros2 topic list                                                   # /emg/raw /imu/forearm /imu/hand
ros2 topic hz /imu/hand                                           # ~100
ros2 topic hz /emg/raw                                            # ~100 msg/s
ros2 topic echo /emg/raw --qos-reliability best_effort --field flexor   # live EMG channel 1
```

An IMU topic that exists but publishes at 0 Hz = that chip is not responding
(cable, address jumper). The firmware retries it every second.

**Before every EMG session:** each channel at rest must read a low, moving
baseline (tens to a few hundred counts). A flat `4095` or a flat ~`3760` means
the MyoWare is railed: reseat the electrodes (reference snap on bone), lower
the gain pot. Railed data is unusable.

**C — record a run:**

```bash
ros2 run wrist_exo csv_logger --ros-args -p out_dir:=~/exo_runs -p label:=flex_reps
```

Prints the run folder and a rate line every 2 s (expect `imu/hand: 100/s,
imu/forearm: 100/s, emg/raw: 1000/s` — a 0 means that stream is down, stop and
fix). **Press Enter** at the start of each rep to drop a marker (type a word
first to name it). **Ctrl-C** ends the run. Output:

```
~/exo_runs/<timestamp>_<label>/
  imu_hand.csv      t, ax, ay, az, gx, gy, gz     (t = Unix seconds)
  imu_forearm.csv   same
  emg.csv           t, flexor, extensor           (1 kHz, expanded from batches)
  events.csv        t, event                      (Enter markers, host clock)
  meta.json         label, notes, start time
```

Protocol that works: `rest` (10 s), `flex_reps`, `ext_reps`; start each run
with >=2 s of rest (the plot script uses the first 2 s as noise baseline).

**D — plot:**

```bash
python3 analysis/plot_run.py ~/exo_runs/<run_folder> --save     # add --axis gy to force the gyro axis
```

Writes `timeseries.png`, `onsets.png`, `correlation.png` into the run folder
and prints the per-rep onset table. Thresholds (`K_SIGMA`, `GYRO_THRESH`) are at
the top of the script.

---

## 6. Known issues / gotchas

- Both IMUs at the same address (forgot the ADR jumper) -> only `/imu/hand` carries data.
- STEMMA cable disconnect mid-run -> that IMU goes silent for ~1 s then recovers (firmware re-init). Tape the cables.
- A stall longer than 1 s (ring buffer size) also drops EMG samples: `loop()` is cooperative.
- EMG ENV output has a 3.6 Hz low-pass (~44 ms lag). Fine for the pipeline check, not for onset timing — switch to RAW + software envelope before the real trials.
- Channel-to-muscle identity (ch. 1 = A5 sensor, ch. 2 = D5 sensor) must be verified per session with an isometric contraction; the CSV column names `flexor`/`extensor` are wiring labels, not verified physiology.
- `pio run` from the repo root builds nothing useful; the scanner lives in `tools/i2c_scanner/`.
