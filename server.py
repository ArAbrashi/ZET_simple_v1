"""
Lokalni server za Podravka BESS dashboard.
Pokreni:  python server.py
Otvori:   http://localhost:8000/dashboard.html
"""

import http.server
import json
import os
import subprocess
import sys

PORT = 8002
DIR = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_POST(self):
        if self.path == "/save-input":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
                path = os.path.join(DIR, "input_2.json")
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True}).encode())
                print(f"[SAVED] input_2.json ({len(body)} bytes)")
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
        elif self.path == "/run-simulation":
            try:
                print("[RUN] Pokrecem main.py ...")
                result = subprocess.run(
                    [sys.executable, os.path.join(DIR, "main.py")],
                    cwd=DIR,
                    capture_output=True,
                    text=True,
                    timeout=120,
                )
                ok = result.returncode == 0
                self.send_response(200 if ok else 500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "ok": ok,
                    "stdout": result.stdout[-2000:] if result.stdout else "",
                    "stderr": result.stderr[-2000:] if result.stderr else "",
                }).encode())
                print(f"[RUN] {'OK' if ok else 'GRESKA'} (exit code {result.returncode})")
            except subprocess.TimeoutExpired:
                self.send_response(504)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Timeout (120s)"}).encode())
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path == "/run-simulation-stream":
            try:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("X-Accel-Buffering", "no")
                http.server.BaseHTTPRequestHandler.end_headers(self)

                proc = subprocess.Popen(
                    [sys.executable, os.path.join(DIR, "main.py")],
                    cwd=DIR,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                )
                print("[STREAM] Pokrecem main.py ...")
                for line in iter(proc.stdout.readline, ""):
                    line = line.rstrip()
                    if line:
                        self.wfile.write(
                            f"data: {json.dumps(line)}\n\n".encode("utf-8")
                        )
                        self.wfile.flush()
                proc.wait()
                ok = proc.returncode == 0
                self.wfile.write(
                    f"event: done\ndata: {json.dumps({'ok': ok})}\n\n".encode("utf-8")
                )
                self.wfile.flush()
                print(f"[STREAM] {'OK' if ok else 'GRESKA'} (exit code {proc.returncode})")
            except BrokenPipeError:
                pass
            except Exception as e:
                print(f"[STREAM ERROR] {e}")
        else:
            super().do_GET()


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("", PORT), Handler)
    print(f"Server pokrenut na http://localhost:{PORT}")
    print(f"Dashboard:     http://localhost:{PORT}/dashboard.html")
    print(f"Input Editor:  http://localhost:{PORT}/input-editor.html")
    print("Ctrl+C za zaustavljanje")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer zaustavljen.")
