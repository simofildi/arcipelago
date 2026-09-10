"""Dashboard.

A minimal HTTP server (`http.server` only) bridging the browser and Redis: it
reads the snapshots published by the islands and forwards user commands onto the
control keys the islands read every generation.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import redis

ISLANDS = [s.strip() for s in os.environ.get("ISLANDS", "island-1,island-2,island-3").split(",") if s.strip()]
PORT = int(os.environ.get("PORT", "8080"))
LINGER = int(os.environ.get("LINGER_SECONDS", "180"))
# Whether the islands are waiting to be started from here, which changes what the
# terminal should tell the person to do. Read from the same variable the islands use.
ARMED = os.environ.get("START_MODE", "armed").strip().lower() != "auto"
VIEWER_WAIT = int(float(os.environ.get("VIEWER_TIMEOUT", "180")))
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

# Deliberately short: the page loads its own HTML, its stylesheet and its ES modules,
# and nothing else. No image, no font, no third-party bundle — so a request for any
# other kind of file is a mistake and is answered as one.
MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
}

CLIENT: redis.Redis | None = None


def connect() -> redis.Redis:
    host = os.environ.get("REDIS_HOST", "redis")
    client = redis.Redis(host=host, port=int(os.environ.get("REDIS_PORT", "6379")), decode_responses=True)
    for _ in range(60):
        try:
            client.ping()
            return client
        except redis.exceptions.ConnectionError:
            time.sleep(1)
    raise SystemExit("[dashboard] redis unreachable")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args) -> None:  # silence the per-request access log
        return

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, payload: dict, status: int = 200) -> None:
        self._send(status, json.dumps(payload).encode("utf-8"), "application/json; charset=utf-8")

    def _static(self, relative: str) -> None:
        """Serve one file from the static directory, and nothing outside it.

        The page is a handful of native ES modules rather than one large inline
        script, so the server has to answer more than a single path — and a browser
        refuses a module served as anything but a JavaScript MIME type, which is why
        the map below is not optional.
        """
        root = os.path.realpath(STATIC)
        target = os.path.realpath(os.path.join(root, relative))
        # Anything that resolves outside the static directory is somebody probing.
        if target != root and not target.startswith(root + os.sep):
            self._send(403, b"forbidden", "text/plain; charset=utf-8")
            return
        kind = MIME.get(os.path.splitext(target)[1])
        if kind is None:
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        try:
            with open(target, "rb") as handle:
                self._send(200, handle.read(), kind)
        except OSError:
            self._send(404, f"{relative} not found".encode("utf-8"), "text/plain; charset=utf-8")

    def do_GET(self) -> None:
        if self.path in ("/", "/index.html"):
            self._static("index.html")
            return

        if self.path.startswith("/js/") or self.path == "/app.css":
            self._static(self.path.lstrip("/"))
            return

        # Browsers ask for this unprompted; answering keeps the console clean without
        # shipping an asset the page does not need.
        if self.path == "/favicon.ico":
            self._send(204, b"", "image/x-icon")
            return

        if self.path == "/state":
            # A page asking for state is the earliest moment a viewer can receive
            # anything, so this is what releases islands started with
            # START_MODE=armed: they wait for a viewer before deciding nobody is coming.
            CLIENT.set("viewer:seen", "1")
            snapshots = []
            for island in ISLANDS:
                raw = CLIENT.get(f"state:{island}")
                if raw:
                    snapshots.append(json.loads(raw))
            controls = {i: CLIENT.hgetall(f"control:{i}") for i in ISLANDS}
            finished = all(CLIENT.get(f"done:{i}") == "1" for i in ISLANDS)
            started = CLIENT.get("run:go") is not None
            self._json({"islands": snapshots, "controls": controls,
                        "finished": finished, "started": started})
            return

        self._send(404, b"not found", "text/plain; charset=utf-8")

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._json({"error": "malformed request body"}, 400)
            return

        # Starting the run is the one command that belongs to the archipelago rather
        # than to an island, so it is answered before the per-island check below.
        if self.path == "/start":
            try:
                generations = max(0, int(payload.get("generations", 0)))
            except (TypeError, ValueError):
                self._json({"error": "generations must be a whole number"}, 400)
                return
            CLIENT.set("run:go", str(generations))
            shape = "no ceiling" if generations == 0 else f"{generations} generations"
            print(f"[dashboard] run started from the interface: {shape}", flush=True)
            self._json({"ok": True, "generations": generations})
            return

        island = payload.get("island")
        if island not in ISLANDS:
            self._json({"error": f"unknown island: {island}"}, 400)
            return

        if self.path == "/control":
            key, value = payload.get("key"), payload.get("value")
            if key is None:
                self._json({"error": "missing parameter name"}, 400)
                return
            CLIENT.hset(f"control:{island}", key, str(value))
            self._json({"ok": True, "island": island, key: value})
            return

        if self.path == "/command":
            CLIENT.lpush(f"cmd:{island}", json.dumps(payload))
            self._json({"ok": True, "island": island, "op": payload.get("op")})
            return

        self._send(404, b"not found", "text/plain; charset=utf-8")


def watchdog(server: ThreadingHTTPServer) -> None:
    """Shut the dashboard down once the run is over, so `docker compose up` returns."""
    while True:
        time.sleep(5)
        if CLIENT.get("done:collector") == "1":
            print(f"[dashboard] run finished, staying up for another {LINGER}s", flush=True)
            time.sleep(LINGER)
            server.shutdown()
            return


def main() -> int:
    global CLIENT
    CLIENT = connect()
    # A fresh stack has no viewer yet. Clearing it here rather than in the islands
    # keeps the gate owned by the one service that can actually observe a viewer.
    CLIENT.delete("viewer:seen", "run:go")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    threading.Thread(target=watchdog, args=(server,), daemon=True).start()
    rule = "-" * 60
    if ARMED:
        lines = [rule,
                 "  The archipelago is seeded and standing by.",
                 "",
                 f"  1. Open  http://localhost:{PORT}",
                 "  2. Choose how many generations to run",
                 "  3. Press Start",
                 "",
                 "  Nothing evolves until you do. Output is written as it runs.",
                 f"  If nobody opens it within {VIEWER_WAIT}s the islands run on their own.",
                 rule]
    else:
        lines = [rule,
                 "  The archipelago is running.",
                 f"  Open  http://localhost:{PORT}  to watch and steer it.",
                 rule]
    for line in lines:
        print(f"[dashboard] {line}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    print("[dashboard] shutting down", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
