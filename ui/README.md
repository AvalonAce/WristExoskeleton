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
ui/backend/server.py   local storage server (stdlib Python): ~/exo_data/store.json + rosbags
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
| `live` (`npm run dev:live`) | rosbridge `ws://localhost:9090`: `/imu/hand`, `/imu/forearm`, `/emg/raw`, `/wrist/state` | storage server (`ui/backend/server.py`, port 8765, reached at `/api`) → `~/exo_data` |

Set it in `ui/frontend/.env.local` (see `.env.example`). Pages never import a source directly,
only `stream` and `api` from `src/data`, so switching to live data needs no page changes.

Reset the mock data: in the browser console, `localStorage.removeItem('wrist-exo-mock-v3')`, then reload.

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

## Capture screen (class demo, default after sign in)

Sign in → `/capture`. Left: participants (**+ New participant**: code, optional label, wrist).
Top: live angle and EMG, **Set neutral** (wrist straight, 2 s), **Flip direction** (if flexion
reads as extension), a note, **Record / Stop**. Each recording saves max flexion / extension,
peak speed, reps each way (past 15°, back under 5°), EMG peak + mean, a 20 Hz trace, and a rosbag
(`~/exo_data/bags/<code>_<YYYYMMDD_HHMMSS>/`). **Trace CSV** per recording; **Export all CSV** =
one row per recording, every participant. The full dashboard is still at `/dashboard`.

## Health check (guided protocol, at /dashboard)

Dashboard → patient → **Health check** tab → **Start health check**. Guided: reference wrist first,
then treated; each wrist does a flexion block and an extension block (re-orient the exo between).
Each block: fit + calibrate → range (3 reps + goniometer) → comfortable pace (5 reps) →
loaded 30 s at spring 1 → pain 0–10. The visit is saved after every block.
Process and how to read results: the "Wrist Exo Health Check: Usage Guide" doc.

Live mode storage (started by `scripts/run_all.sh`, or by hand with the workspace sourced):

```bash
python3 ui/backend/server.py      # http://127.0.0.1:8765, data in ~/exo_data
```

- `~/exo_data/store.json` participants, sessions, health checks (backups in `~/exo_data/backups/`)
- `~/exo_data/bags/<code>_<date>_<wrist>_<direction>_<test>/` one rosbag per test step
- Results tab → Export CSV, one row per block

Reps are counted in the browser from `excursion_deg` (start > 3°, counts if > 10°, ends < 5°),
not from the phase classifier. Metrics: `src/lib/healthMetrics.ts`.
