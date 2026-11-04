#!/usr/bin/env bash
# run_exo.sh - boot the wrist exo sensor stack (WSL Ubuntu 24.04, ROS 2 Jazzy)
#
# Usage:
#   ./run_exo.sh                 start agent, check topics
#   ./run_exo.sh --build         colcon build the ROS workspace first
#   ./run_exo.sh --flash         pio build + flash firmware first
#   ./run_exo.sh --plot          open PlotJuggler once topics appear
#   ./run_exo.sh --build --flash --plot
#
# Env overrides:
#   PORT=/dev/ttyACM0  BAUD=115200  REPO=~/WristExoskeleton
#   EXTRA_CMD="ros2 run <pkg> <logger_node>"   (run in background after boot)
#
# Before running: attach the board from Windows PowerShell (admin):
#   usbipd list
#   usbipd bind --busid <BUSID>        (once)
#   usbipd attach --wsl --busid <BUSID>

set +u

REPO="${REPO:-$HOME/WristExoskeleton}"
BAUD="${BAUD:-115200}"
PORT="${PORT:-}"
DO_BUILD=0; DO_FLASH=0; DO_PLOT=0

for a in "$@"; do
  case "$a" in
    --build) DO_BUILD=1 ;;
    --flash) DO_FLASH=1 ;;
    --plot)  DO_PLOT=1 ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a"; exit 1 ;;
  esac
done

die() { echo "ERROR: $*" >&2; exit 1; }

# --- 1. Repo / branch ---------------------------------------------------
[ -d "$REPO" ] || die "Repo not found at $REPO"
BRANCH="$(git -C "$REPO" branch --show-current)"
[ "$BRANCH" = "micro-ros-sensors" ] || die "On branch '$BRANCH'. Run: git -C $REPO checkout micro-ros-sensors"

# --- 2. ROS environment -------------------------------------------------
[ -f /opt/ros/jazzy/setup.bash ] || die "ROS 2 Jazzy not installed"
# shellcheck disable=SC1091
source /opt/ros/jazzy/setup.bash
[ -f "$HOME/microros_ws/install/setup.bash" ] && source "$HOME/microros_ws/install/setup.bash"

# --- 3. pio sanity ------------------------------------------------------
if command -v pio >/dev/null 2>&1; then
  PIO_PATH="$(command -v pio)"
  [ "$PIO_PATH" != "/usr/bin/pio" ] || die "Using broken apt pio. Run: sudo apt remove -y platformio; hash -r"
elif [ "$DO_FLASH" -eq 1 ]; then
  die "pio not found. Fix PATH (source ~/.bashrc) or reinstall PlatformIO"
fi

# --- 4. Build ROS workspace --------------------------------------------
if [ "$DO_BUILD" -eq 1 ] || [ ! -f "$REPO/exo_ws/install/setup.bash" ]; then
  echo ">> Building ROS workspace"
  ( cd "$REPO/exo_ws" && colcon build --symlink-install ) || die "colcon build failed"
fi
# shellcheck disable=SC1091
source "$REPO/exo_ws/install/setup.bash"

# --- 5a. Auto-attach the board from Windows (usbipd.exe via WSL interop) -
attach_board() {
  command -v usbipd.exe >/dev/null 2>&1 || return 0
  ls /dev/ttyACM* /dev/ttyUSB* >/dev/null 2>&1 && return 0
  local line busid
  # 303a = Espressif VID (normal mode 303a:1001, bootloader 303a:0002)
  line="$(usbipd.exe list 2>/dev/null | tr -d '\r' | grep -iE '303a:|239a:' | head -n1 || true)"
  [ -n "$line" ] || { echo "!! usbipd sees no Espressif device. Check cable / re-plug."; return 0; }
  busid="$(echo "$line" | awk '{print $1}')"
  if echo "$line" | grep -qi 'not shared'; then
    echo "!! Board $busid is not shared. ONE TIME, in Windows PowerShell (admin):"
    echo "     usbipd bind --busid $busid"
    return 0
  fi
  echo ">> Attaching board $busid to WSL"
  usbipd.exe attach --wsl --busid "$busid" 2>&1 | tr -d '\r' || true
  sleep 2
}
attach_board

# --- 5. Find the serial port -------------------------------------------
if [ -z "$PORT" ]; then
  PORT="$(ls /dev/ttyACM* /dev/ttyUSB* 2>/dev/null | head -n1 || true)"
fi
if [ -z "$PORT" ] || [ ! -e "$PORT" ]; then
  cat >&2 <<EOF
ERROR: No board serial port found (only fake ttyS* ports exist).
Attach it from Windows PowerShell (admin):
  usbipd list
  usbipd attach --wsl --busid <BUSID>
Then rerun this script.
EOF
  exit 1
fi
if [ ! -r "$PORT" ] || [ ! -w "$PORT" ]; then
  die "No permission on $PORT. Run: sudo usermod -aG dialout \$USER  then 'wsl --shutdown' and reopen"
fi
echo ">> Using port $PORT @ $BAUD"

# --- 6. Flash firmware (optional) --------------------------------------
if [ "$DO_FLASH" -eq 1 ]; then
  echo ">> Building and flashing firmware"
  ( cd "$REPO/firmware" && pio run -t upload --upload-port "$PORT" ) \
    || die "Flash failed. Double-tap RESET for bootloader, re-run usbipd attach, retry"
  echo ">> Flashed. Waiting for the board to re-enumerate..."
  sleep 4
  if [ ! -e "$PORT" ]; then
    PORT="$(ls /dev/ttyACM* /dev/ttyUSB* 2>/dev/null | head -n1 || true)"
    [ -n "$PORT" ] || die "Port vanished after flash. Re-run: usbipd attach --wsl --busid <BUSID>"
    echo ">> Port is now $PORT"
  fi
fi

# --- 7. micro-ROS agent -------------------------------------------------
ros2 pkg prefix micro_ros_agent >/dev/null 2>&1 \
  || die "micro_ros_agent missing. Run: sudo apt install -y ros-jazzy-micro-ros-agent"

# Free the port if a serial monitor is holding it
pkill -f "pio device monitor" 2>/dev/null || true

AGENT_LOG=/tmp/micro_ros_agent.log
echo ">> Starting micro-ROS agent (log: $AGENT_LOG)"
ros2 run micro_ros_agent micro_ros_agent serial --dev "$PORT" -b "$BAUD" >"$AGENT_LOG" 2>&1 &
AGENT_PID=$!
PIDS="$AGENT_PID"

cleanup() {
  echo; echo ">> Shutting down"
  # shellcheck disable=SC2086
  kill $PIDS 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 2
kill -0 "$AGENT_PID" 2>/dev/null || { cat "$AGENT_LOG"; die "Agent exited. Check port/baud and press RESET on the board"; }

# --- 8. Wait for topics -------------------------------------------------
echo ">> Waiting for board topics (press RESET on the board if this stalls)..."
FOUND=0
for _ in $(seq 1 30); do
  TOPICS="$(ros2 topic list 2>/dev/null | grep -vE '^/(parameter_events|rosout)$' || true)"
  if [ -n "$TOPICS" ]; then FOUND=1; break; fi
  sleep 1
done
if [ "$FOUND" -eq 1 ]; then
  echo ">> Topics up:"; echo "$TOPICS"
else
  echo "!! No topics after 30 s. Agent log tail:"; tail -n 15 "$AGENT_LOG"
fi

# --- 9. Optional extras -------------------------------------------------
if [ -n "${EXTRA_CMD:-}" ]; then
  echo ">> Running: $EXTRA_CMD"
  bash -c "$EXTRA_CMD" &
  PIDS="$PIDS $!"
fi

if [ "$DO_PLOT" -eq 1 ]; then
  if ros2 pkg prefix plotjuggler >/dev/null 2>&1; then
    echo ">> Opening PlotJuggler (Streaming > ROS 2 Topic Subscriber)"
    ros2 run plotjuggler plotjuggler &
    PIDS="$PIDS $!"
  else
    echo "!! PlotJuggler missing. Run: sudo apt install -y ros-jazzy-plotjuggler-ros"
  fi
fi

echo ">> Running. Ctrl+C to stop everything."
wait "$AGENT_PID"