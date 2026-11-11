#!/usr/bin/env bash
# One terminal for a live session: micro-ROS agent (Docker), wrist_state, rosbridge, and the UI.
# Also starts the storage server (ui/backend/server.py): profiles, health checks, rosbags in ~/exo_data.
# Ctrl+C stops everything. Logs: ~/exo_runs/logs/<timestamp>/{agent,state,rosbridge,api}.log
#
# Usage:  ./scripts/run_all.sh            live, exo plugged in
#         ./scripts/run_all.sh --build    rebuild exo_ws + npm install first
#         ./scripts/run_all.sh --mock     UI only with demo data (no ROS, no exo)
#         ./scripts/run_all.sh --dev /dev/ttyACM0   use a specific serial device
#
# Docker: uses sudo automatically if your user can't reach Docker (asks for the password once).
# WSL2: attach the board with usbipd first (see README section 3b).
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WS="$REPO/exo_ws"
UI="$REPO/ui/frontend"
BUILD=0
MOCK=0
DEV=""
AGENT_NAME="exo_agent"

while [ $# -gt 0 ]; do
  case "$1" in
    --build) BUILD=1 ;;
    --mock) MOCK=1 ;;
    --dev) DEV="${2:-}"; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)"; exit 2 ;;
  esac
  shift
done

say()  { printf '\033[1;36m[run]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[run]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[run]\033[0m %s\n' "$*"; exit 1; }

# ---------------------------------------------------------------- UI-only mode
if [ "$MOCK" = 1 ]; then
  cd "$UI" || die "No UI folder at $UI"
  [ -d node_modules ] || npm install || die "npm install failed"
  say "Demo data mode: open http://localhost:5173"
  exec npm run dev
fi

# ---------------------------------------------------------------- process bookkeeping
LOG_DIR="$HOME/exo_runs/logs/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$LOG_DIR"
GROUPS_=()   # process-group ids of background jobs
NAMES=()
DOCKER="docker"
KEEPALIVE=""
AGENT_PID=""

cleanup() {
  trap - INT TERM EXIT
  echo
  say "Stopping everything"
  for pg in "${GROUPS_[@]:-}"; do [ -n "$pg" ] && kill -TERM -- "-$pg" 2>/dev/null; done
  $DOCKER stop "$AGENT_NAME" >/dev/null 2>&1 || true
  [ -n "$AGENT_PID" ] && kill "$AGENT_PID" 2>/dev/null
  [ -n "$KEEPALIVE" ] && kill "$KEEPALIVE" 2>/dev/null
  sleep 1
  for pg in "${GROUPS_[@]:-}"; do [ -n "$pg" ] && kill -KILL -- "-$pg" 2>/dev/null; done
  say "Stopped. Logs in $LOG_DIR"
}
trap cleanup INT TERM EXIT

# Start a command in its own process group so Ctrl+C can stop it and all its children.
start() {  # start <name> <logfile> <command...>
  local name="$1" log="$2"; shift 2
  setsid bash -c "$*" >"$log" 2>&1 < /dev/null &
  GROUPS_+=("$!")
  NAMES+=("$name")
}

# ---------------------------------------------------------------- environment
[ -n "${CONDA_PREFIX:-}" ] && warn "conda is active ($CONDA_PREFIX); if the build fails with 'No module named em', run 'conda deactivate' first."
[ -f /opt/ros/jazzy/setup.bash ] || die "ROS 2 Jazzy not found at /opt/ros/jazzy"
set +u
# shellcheck disable=SC1091
source /opt/ros/jazzy/setup.bash
set -u

if [ "$BUILD" = 1 ]; then
  say "Building exo_ws"
  (cd "$WS" && colcon build --packages-select wrist_exo_msgs wrist_exo) || die "colcon build failed"
  say "Installing UI packages"
  (cd "$UI" && npm install) || die "npm install failed"
fi
[ -f "$WS/install/setup.bash" ] || die "exo_ws is not built. Run: ./scripts/run_all.sh --build"
set +u
# shellcheck disable=SC1091
source "$WS/install/setup.bash"
set -u
[ -d "$UI/node_modules" ] || { say "Installing UI packages"; (cd "$UI" && npm install) || die "npm install failed"; }
ros2 pkg prefix rosbridge_server >/dev/null 2>&1 || die "rosbridge missing. Run: sudo apt install ros-jazzy-rosbridge-suite"

# ---------------------------------------------------------------- docker access
if ! docker info >/dev/null 2>&1; then
  say "Docker needs sudo for this user; enter your password once"
  sudo -v || die "sudo failed"
  DOCKER="sudo docker"
  # keep the sudo ticket alive while we run (docker stop on exit needs it)
  ( while true; do sudo -n true 2>/dev/null; sleep 50; done ) &
  KEEPALIVE=$!
fi

# ---------------------------------------------------------------- serial device
if [ -z "$DEV" ]; then
  say "Waiting for the exo on USB (press RESET on the Feather if it does not appear)"
  for _ in $(seq 1 30); do
    DEV="$(ls /dev/serial/by-id/usb-Adafruit_Feather_ESP32-S3*-if00 2>/dev/null | head -n1 || true)"
    [ -n "$DEV" ] && break
    if ls /dev/serial/by-id/*Espressif*JTAG* >/dev/null 2>&1; then
      warn "Board is in its bootloader (Espressif USB JTAG). Press RESET on the Feather."
    fi
    sleep 1
  done
  [ -n "$DEV" ] || die "No exo found on USB after 30 s. Plug it in (WSL: usbipd attach) and retry."
fi
say "Exo on $DEV"

# ---------------------------------------------------------------- 1. agent
$DOCKER rm -f "$AGENT_NAME" >/dev/null 2>&1 || true
# Not in its own session (unlike the others): sudo's cached password is tied to this terminal.
# No -it (there is no interactive terminal for it); stopped by name on exit.
$DOCKER run --rm --name "$AGENT_NAME" -v /dev:/dev --privileged --net=host \
  microros/micro-ros-agent:jazzy serial --dev "$DEV" -b 115200 -v4 >"$LOG_DIR/agent.log" 2>&1 </dev/null &
AGENT_PID=$!
say "Agent starting (log: agent.log). Waiting for the board's topics"
connected=0
for _ in $(seq 1 25); do
  if ros2 topic list 2>/dev/null | grep -q '^/emg/raw$'; then connected=1; break; fi
  sleep 1
done
if [ "$connected" = 1 ]; then
  for imu in hand forearm; do
    n="$(ros2 topic info /imu/$imu 2>/dev/null | sed -n 's/^Publisher count: //p')"
    if [ "${n:-0}" -ge 1 ]; then say "IMU $imu: publishing"
    else warn "IMU $imu: not found at boot. Reseat its cable, then press RESET on the Feather."; fi
  done
else
  warn "No data from the board yet. Press RESET on the Feather; the agent will reconnect."
fi

# ---------------------------------------------------------------- 2. state node, 3. rosbridge
start wrist_state "$LOG_DIR/state.log" "ros2 run wrist_exo wrist_state"
start rosbridge "$LOG_DIR/rosbridge.log" "ros2 launch rosbridge_server rosbridge_websocket_launch.xml"
# Storage + rosbag recording for profiles and health checks (data in ~/exo_data).
start api "$LOG_DIR/api.log" "python3 '$REPO/ui/backend/server.py'"
for _ in $(seq 1 15); do
  (exec 3<>/dev/tcp/127.0.0.1/9090) 2>/dev/null && break
  sleep 1
done
(exec 3<>/dev/tcp/127.0.0.1/9090) 2>/dev/null && say "rosbridge ready on ws://localhost:9090" \
  || warn "rosbridge not answering yet; see $LOG_DIR/rosbridge.log"
(exec 3<>/dev/tcp/127.0.0.1/8765) 2>/dev/null && say "storage ready, data in ~/exo_data" \
  || warn "storage server not answering yet; see $LOG_DIR/api.log"

# Report if a background part dies while the UI runs.
(
  while sleep 3; do
    if [ -n "$AGENT_PID" ] && ! kill -0 "$AGENT_PID" 2>/dev/null; then
      warn "agent stopped. See $LOG_DIR/agent.log"; AGENT_PID=""
    fi
    for i in "${!GROUPS_[@]}"; do
      kill -0 "${GROUPS_[$i]}" 2>/dev/null || { warn "${NAMES[$i]} stopped. See $LOG_DIR/${NAMES[$i]/wrist_/}.log"; GROUPS_[$i]=""; }
    done
  done
) &
WATCH=$!
GROUPS_+=("")  # placeholder so cleanup's loop shape stays the same
trap 'kill $WATCH 2>/dev/null; cleanup' INT TERM EXIT

# ---------------------------------------------------------------- 4. UI (foreground)
say "Open http://localhost:5173  (Ctrl+C here stops everything)"
( sleep 4; xdg-open http://localhost:5173 >/dev/null 2>&1 || true ) &
cd "$UI" && npm run dev:live
