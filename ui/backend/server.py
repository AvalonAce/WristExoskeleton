#!/usr/bin/env python3
"""Local storage + recording server for the Wrist Exo UI. Standard library only.

  GET  /api/health            {"ok": true, "dataDir": ..., "recording": name|null}
  GET  /api/store             the whole store (patients, sessions, healthChecks) or {} if none yet
  PUT  /api/store             replace the store (JSON body). Writes atomically, keeps backups.
  POST /api/bag/start         {"name": "P-001_20261111_R_flexion"} -> starts `ros2 bag record`
  POST /api/bag/stop          stops the running recording (SIGINT, so the bag is closed cleanly)

Data lives in ~/exo_data (override with EXO_DATA_DIR), outside the git repo.
Run with the ROS workspace sourced so `ros2 bag` can decode EmgBatch/WristState:
  source exo_ws/install/setup.bash && python3 ui/backend/server.py
"""
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("EXO_API_PORT", "8765"))
DATA = Path(os.environ.get("EXO_DATA_DIR", Path.home() / "exo_data"))
STORE = DATA / "store.json"
BACKUPS = DATA / "backups"
BAGS = DATA / "bags"
KEEP_BACKUPS = 50
TOPICS = ["/imu/hand", "/imu/forearm", "/emg/raw", "/wrist/state"]
MAX_BODY = 20 * 1024 * 1024

lock = threading.Lock()
bag = {"proc": None, "name": None, "log": None}


def log(msg):
    print(f"[api] {datetime.now():%H:%M:%S} {msg}", flush=True)


def read_store():
    if not STORE.exists():
        return {}
    return json.loads(STORE.read_text())


def write_store(obj):
    DATA.mkdir(parents=True, exist_ok=True)
    BACKUPS.mkdir(exist_ok=True)
    if STORE.exists():
        shutil.copy2(STORE, BACKUPS / f"store_{datetime.now():%Y%m%d_%H%M%S_%f}.json")
        old = sorted(BACKUPS.glob("store_*.json"))
        for f in old[:-KEEP_BACKUPS]:
            f.unlink(missing_ok=True)
    tmp = STORE.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, indent=1))
    os.replace(tmp, STORE)  # atomic: a crash never leaves a half-written store


def bag_stop():
    p = bag["proc"]
    if p is None:
        return None
    name = bag["name"]
    if p.poll() is None:
        p.send_signal(signal.SIGINT)
        try:
            p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            p.kill()
    if bag["log"]:
        bag["log"].close()
    bag.update(proc=None, name=None, log=None)
    log(f"bag stopped: {name}")
    return name


def bag_start(name):
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}", name or ""):
        raise ValueError("bad bag name")
    bag_stop()
    BAGS.mkdir(parents=True, exist_ok=True)
    out = BAGS / name
    if out.exists():  # same test redone: keep the old one beside it
        out = BAGS / f"{name}_{datetime.now():%H%M%S}"
    if shutil.which("ros2") is None:
        raise RuntimeError("ros2 not on PATH (source ROS and the workspace before starting the server)")
    logf = open(BAGS / f"{out.name}.log", "w")
    proc = subprocess.Popen(["ros2", "bag", "record", "-o", str(out), *TOPICS],
                            stdout=logf, stderr=subprocess.STDOUT, start_new_session=True)
    time.sleep(0.5)
    if proc.poll() is not None:
        logf.close()
        raise RuntimeError(f"ros2 bag record exited at once; see {logf.name}")
    bag.update(proc=proc, name=out.name, log=logf)
    log(f"bag recording: {out}")
    return out.name


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quiet: only our own log lines
        pass

    def send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("body too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        try:
            if self.path == "/api/health":
                return self.send(200, {"ok": True, "dataDir": str(DATA), "recording": bag["name"]})
            if self.path == "/api/store":
                with lock:
                    return self.send(200, read_store())
            self.send(404, {"error": "not found"})
        except Exception as e:  # noqa: BLE001
            log(f"GET {self.path} failed: {e}")
            self.send(500, {"error": str(e)})

    def do_PUT(self):
        try:
            if self.path != "/api/store":
                return self.send(404, {"error": "not found"})
            obj = self.body()
            if not isinstance(obj, dict):
                return self.send(400, {"error": "store must be an object"})
            with lock:
                write_store(obj)
            self.send(200, {"ok": True})
        except Exception as e:  # noqa: BLE001
            log(f"PUT failed: {e}")
            self.send(500, {"error": str(e)})

    def do_POST(self):
        try:
            if self.path == "/api/bag/start":
                with lock:
                    name = bag_start(self.body().get("name"))
                return self.send(200, {"ok": True, "name": name})
            if self.path == "/api/bag/stop":
                with lock:
                    name = bag_stop()
                return self.send(200, {"ok": True, "name": name})
            self.send(404, {"error": "not found"})
        except ValueError as e:
            self.send(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            log(f"POST {self.path} failed: {e}")
            self.send(500, {"error": str(e)})


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)

    def shutdown(*_):
        bag_stop()
        threading.Thread(target=srv.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    log(f"serving http://127.0.0.1:{PORT}  data: {DATA}")
    srv.serve_forever()
    bag_stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
