# Wrist Exo UI

Web UI for a physical therapist: patient profiles, live session view, session history.
Branch: `ui`. Everything lives under `ui/`; nothing outside this folder is touched.

```
ui/frontend/   Vite + React + TypeScript
  src/data/types.ts       data contract (WristState mirrors wrist_exo_msgs/msg/WristState.msg)
  src/data/mockStream.ts  fake 100 Hz WristState (rest → flex rep → rest → ext rep, EMG leads motion)
  src/data/mockApi.ts     fake patients/sessions, kept in browser localStorage
  src/data/index.ts       picks mock vs live sources (VITE_DATA)
  src/pages/              Patients, Live session, History
ui/backend/    (later) FastAPI + SQLite: profiles, start/stop recording, history data
```

## Run (Linux or WSL2)

Needs Node 18+ (`node -v`).

```bash
cd ui/frontend
npm install          # first time / after package.json changes
npm run dev          # http://localhost:5173
```

- **WSL2:** open `http://localhost:5173` in the Windows browser. Keep the repo in the Linux
  filesystem (`~/...`), not `/mnt/c/...`. If edits don't hot-reload, use `npm run dev:poll`.
- `npm run typecheck`: type errors without starting the server.

## Data sources

| `VITE_DATA` | Live stream | Profiles / sessions |
|---|---|---|
| `mock` (default) | `MockStream` in the browser | `MockApi` (localStorage) |
| `live` (`npm run dev:live`) | rosbridge `ws://localhost:9090`: `/imu/hand`, `/imu/forearm`, `/emg/raw`, `/wrist/state` | still `MockApi` (backend not written yet) |

Set it in `ui/frontend/.env.local` (see `.env.example`). Pages never import a source directly,
only `stream` and `api` from `src/data`, so switching to live data needs no page changes.

Reset the mock data: in the browser console, `localStorage.removeItem('wrist-exo-mock-v2')`, then reload.

Demo patients are fictional. Real patient data must never be committed.

## Hooking up the real exo (live mode)

One-time:

```bash
sudo apt install ros-jazzy-rosbridge-suite
# installing rosbridge can leave ROS packages at mixed versions ("undefined symbol ... fastcdr"):
sudo apt update && sudo apt install --only-upgrade -y 'ros-jazzy-*'
# run the Docker agent without sudo (log out and back in afterwards):
sudo usermod -aG docker $USER
```

Terminals (each: `source ~/development/WR26/WristExoskeleton/exo_ws/install/setup.bash` first;
rosbridge in particular must have the workspace sourced or it cannot decode EmgBatch/WristState):

```bash
# 1 agent (board plugged in)
./scripts/agent.sh /dev/serial/by-id/usb-Adafruit_Feather_ESP32-S3*-if00
# 2 state node
ros2 run wrist_exo wrist_state
# 3 rosbridge
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
# 4 UI
cd ui/frontend && npm run dev:live
```

Open http://localhost:5173, sign in, and the connect checks listen to the real topics.
Add patient → step 1 "Connect the exo" shows each sensor live (message rate, values, 5 s plot).
The sensor test uses only the raw topics, so it works even before `wrist_state` is running.

If rosbridge is up but a sensor shows "No data" while `ros2 topic hz` shows it publishing,
suspect a QoS mismatch (the firmware publishes best-effort); report it, there is a fix.
