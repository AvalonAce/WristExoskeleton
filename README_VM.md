# Running the WristExoskeleton repo in a Linux VM (Windows host)

For a teammate on a Windows laptop with an **Ubuntu 24.04 + ROS 2 Jazzy** VM (XFCE desktop,
VirtualBox or VMware). Everything below runs **inside the VM** unless marked *Windows*.
The main [README.md](README.md) is the reference for hardware, wiring and the data format; this
file only covers what is different for a VM.

Three ways to work, pick what you need:

| Mode | Needs | Use it for |
|---|---|---|
| **A. Recorded data only** | VM + bag/CSV folders from Rye | developing/tuning `wrist_state`, plots. No hardware. |
| **B. Hardware on your laptop** | A + USB passthrough + Docker | live sessions with the ESP32 plugged into your laptop |
| **C. Shared topics with Rye's laptop** | A + bridged network | watching/recording Rye's live session from your VM |

---

## 1. One-time setup (all modes)

```bash
sudo apt update && sudo apt install -y git python3-pip docker.io \
  ros-jazzy-plotjuggler-ros ros-jazzy-rosbag2-storage-mcap
pip install --user --break-system-packages pandas matplotlib numpy
sudo usermod -aG dialout,docker $USER        # serial port + docker without sudo
# log out of XFCE and back in (or reboot the VM) for the groups to apply

git clone -b micro-ros-sensors https://github.com/AvalonAce/WristExoskeleton.git ~/WristExoskeleton
echo 'source /opt/ros/jazzy/setup.bash' >> ~/.bashrc
```

Clone into the VM's own disk (`~/`), **not** a shared folder from Windows: shared folders are
slow and break the firmware symlink.

### Build the ROS workspace

```bash
cd ~/WristExoskeleton/exo_ws
colcon build
source install/setup.bash
```

Re-run `colcon build` after every `git pull` that touches `exo_ws/`. Every new terminal needs
`source ~/WristExoskeleton/exo_ws/install/setup.bash` (or add it to `~/.bashrc`).
If you use conda: `conda deactivate` first, or the build fails with `No module named 'em'`.

Check it worked:

```bash
ros2 interface show wrist_exo_msgs/msg/WristState
ros2 pkg executables wrist_exo        # csv_logger, wrist_state
```

---

## 2. Mode A: recorded data (no hardware)

Rye shares run folders (Drive/OneDrive; they are **not** in the repo):

- `bag_<timestamp>/`: rosbag of `/imu/hand`, `/imu/forearm`, `/emg/raw`, `/wrist/state`
- `<timestamp>_<label>/`: CSV run folder from `csv_logger`

Put them in `~/exo_runs/`.

**Replay a bag and run the state node on it** (two terminals):

```bash
# terminal 1
ros2 run wrist_exo wrist_state
# terminal 2  (bag topics minus /wrist/state, so the live node's output is not mixed with the recorded one)
ros2 bag play ~/exo_runs/bag_<timestamp> --topics /imu/hand /imu/forearm /emg/raw
```

`wrist_state` uses message timestamps, not the PC clock, so replay behaves like live.
Add `--rate 0.5` to slow playback, `--loop` to repeat.

**Visualize:** PlotJuggler (see §5). It can also open a bag directly without replaying:
*File → Load data* → pick the `.mcap`/`.db3` file inside the bag folder.

**Offline plots from CSV:**

```bash
python3 ~/WristExoskeleton/analysis/plot_run.py ~/exo_runs/<run_folder> --save
```

---

## 3. Mode B: hardware plugged into your laptop

### 3a. USB passthrough (one-time, VM settings, VM powered off)

The Feather appears as **two different USB devices** depending on mode. Add a filter for **both**,
or the board drops out of the VM during flashing / after RESET:

| Mode | USB VID | Shows as |
|---|---|---|
| running firmware | `239A` | Adafruit Feather ESP32-S3 (TinyUSB) |
| bootloader | `303A` | Espressif USB JTAG/serial debug unit |

- **VirtualBox:** *Settings → USB* → enable **USB 3.0 (xHCI)** (needs the VirtualBox Extension
  Pack installed on Windows) → add a filter per row above (set only Vendor ID).
- **VMware Workstation/Player:** *VM → Removable Devices → Adafruit … → Connect*. To make it
  automatic, tick "remember my choice" when VMware asks where to connect the new device.

Check in the VM after plugging in:

```bash
ls /dev/serial/by-id/          # usb-Adafruit_Feather_ESP32-S3_*-if00
```

### 3b. Flashing firmware: do it from Windows (recommended)

Flashing from the VM works but the board re-enumerates mid-upload (VID changes) and the
hypervisor sometimes hands it back to Windows. Simpler:

1. *Windows:* install VS Code + PlatformIO extension. Clone the repo on Windows too
   (enable Developer Mode and run `git config --global core.symlinks true` **before** cloning, see
   main README §4).
2. *Windows:* open the `firmware/` folder in VS Code → PlatformIO → **Upload**.
3. Press RESET, connect the `239A` device to the VM (filter does it automatically).

Only re-flash when `firmware/` changes. Day-to-day work never touches it.

### 3c. Run a live session

Terminal per line (XFCE terminal, `Ctrl+Shift+T` opens a tab):

```bash
# 1  agent (Docker). Feather LED turns on when connected.
cd ~/WristExoskeleton && ./scripts/agent.sh /dev/serial/by-id/usb-Adafruit_Feather_ESP32-S3*-if00
# 2  state node
ros2 run wrist_exo wrist_state
# 3  bag (raw + state)
ros2 bag record -o ~/exo_runs/bag_$(date +%Y%m%d_%H%M%S) /imu/hand /imu/forearm /emg/raw /wrist/state
# 4  CSV logger (Enter = marker, Ctrl+C = stop). Start last, stop first.
ros2 run wrist_exo csv_logger --ros-args -p label:=flex_ext
```

Health check: `ros2 topic list` must show all four topics; `ros2 topic hz /imu/hand` ≈ 100;
`ros2 topic echo /wrist/state --field status` = 0 when everything is healthy
(1 forearm stale, 2 EMG stale, 4 flexor railed, 8 extensor railed; values add).

Missing `/imu/hand` or `/imu/forearm` in `ros2 topic list` = that IMU did not answer at boot:
reseat its STEMMA cable and press RESET.

Safety: **laptop on battery** (charger unplugged) while electrodes are on skin.

---

## 4. Mode C: see Rye's live topics from your VM

ROS 2 discovers other machines by multicast on the local network. Default VM networking (NAT)
blocks it.

1. VM settings → Network → **Bridged Adapter** (VirtualBox) / **Bridged** (VMware), on the
   Wi-Fi adapter. The VM gets its own IP on the same network as Rye's laptop.
2. Both machines, same domain ID (put it in `~/.bashrc` on both):
   ```bash
   export ROS_DOMAIN_ID=42
   ```
3. Test: Rye runs `ros2 run demo_nodes_cpp talker`; you run `ros2 run demo_nodes_cpp listener`.

If the listener hears nothing: the network blocks multicast (common on campus Wi-Fi such as
DukeBlue/eduroam). Use a phone hotspot or a small router with both laptops on it. Also check
the Windows firewall is not blocking the VM's bridged traffic.

Topics are best-effort sensor data: over Wi-Fi expect some drops. For analysis use the bag
recorded on the machine with the agent, not a copy recorded over the network.

---

## 5. PlotJuggler

```bash
ros2 run plotjuggler plotjuggler
```

Launch from a terminal where the workspace is sourced (otherwise it cannot decode
`WristState`/`EmgBatch`). If it crashes with `symbol lookup error ... /snap/core20/...`, you
launched it from a snap app's terminal (e.g. snap VS Code): use the XFCE terminal instead.

*Streaming → ROS2 Topic Subscriber → Start*, select the topics, drag fields onto plots.
Suggested panels:

| Panel | Fields |
|---|---|
| 1 | `/wrist/state/velocity_dps` |
| 2 | `/imu/hand/angular_velocity/x,y,z`, `/imu/forearm/angular_velocity/x` |
| 3 | `/emg/raw/flexor[0]`, `/emg/raw/extensor[0]` |
| 4 | `/wrist/state/status`, `/wrist/state/phase` |

*File → Save layout* to reuse it (`ros2 run plotjuggler plotjuggler -l layout.xml`).

---

## 6. Current state of the code (2026-10-29)

- `wrist_state` node: computes wrist angular velocity (hand − forearm gyro, hand-only fallback)
  and health flags. **Angle filter, EMG envelope/threshold and phase classifier are stubs**
  (publish NaN / REST) until the method is chosen from recorded data.
- Params: `flex_sign` (±1, + = flexion), `gyro_axis` (x/y/z), `stale_timeout` (0.1 s),
  `sat_level` (4000 counts). Example: `ros2 run wrist_exo wrist_state --ros-args -p flex_sign:=-1`.
- Do not edit `firmware/` from the VM unless coordinated: the firmware build is pinned
  (espressif32@6.9.0) and must be flashed from one known-good machine.
