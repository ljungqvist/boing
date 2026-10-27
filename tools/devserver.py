"""Local-network server for the native app: hands out the APK and receives debug recordings.

Usage: python3 tools/devserver.py [--port 8765] [--data ../boing-data]
  GET  /                    page with links to the APKs in <data>/apk/
  GET  /<name>.apk          the APK
  PUT  /upload?session=S&name=N   saves the body to <data>/uploads/S/N (the app's background upload)
"""
import argparse
import html
import os
import socket
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def safe(name):
    """A plain file or folder name (no paths)."""
    name = os.path.basename(name.replace("\\", "/"))
    if not name or name.startswith("."):
        raise ValueError("bad name")
    return name


def make_handler(data):
    apk_dir = os.path.join(data, "apk")
    up_dir = os.path.join(data, "uploads")

    class Handler(BaseHTTPRequestHandler):
        def send(self, code, body, ctype="text/plain; charset=utf-8"):
            b = body.encode() if isinstance(body, str) else body
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            path = unquote(urlparse(self.path).path)
            os.makedirs(apk_dir, exist_ok=True)
            if path == "/":
                apks = sorted((f for f in os.listdir(apk_dir) if f.endswith(".apk")),
                              key=lambda f: os.path.getmtime(os.path.join(apk_dir, f)), reverse=True)
                items = "".join(
                    f'<li><a href="/{html.escape(f)}">{html.escape(f)}</a> '
                    f'({os.path.getsize(os.path.join(apk_dir, f)) / 1e6:.0f} MB)</li>' for f in apks)
                page = (f"<!doctype html><meta name=viewport content='width=device-width'>"
                        f"<h2>Boing APKs</h2><ul style='font-size:20px;line-height:2'>{items or '<li>none yet</li>'}</ul>")
                return self.send(200, page, "text/html; charset=utf-8")
            try:
                f = os.path.join(apk_dir, safe(path))
            except ValueError:
                return self.send(404, "not found")
            if not f.endswith(".apk") or not os.path.isfile(f):
                return self.send(404, "not found")
            with open(f, "rb") as fh:
                self.send(200, fh.read(), "application/vnd.android.package-archive")

        def do_PUT(self):
            u = urlparse(self.path)
            if u.path != "/upload":
                return self.send(404, "not found")
            q = parse_qs(u.query)
            try:
                session, name = safe(q["session"][0]), safe(q["name"][0])
            except (KeyError, ValueError):
                return self.send(400, "need session and name")
            n = int(self.headers.get("Content-Length", "0"))
            d = os.path.join(up_dir, session)
            os.makedirs(d, exist_ok=True)
            tmp = os.path.join(d, name + ".part")
            with open(tmp, "wb") as fh:
                left = n
                while left > 0:
                    chunk = self.rfile.read(min(left, 1 << 20))
                    if not chunk:
                        break
                    fh.write(chunk)
                    left -= len(chunk)
            if left:
                os.remove(tmp)
                return self.send(400, "incomplete")
            os.replace(tmp, os.path.join(d, name))
            print(f"received {session}/{name} ({n / 1e6:.1f} MB)", flush=True)
            self.send(200, "ok")

        do_POST = do_PUT

        def log_message(self, fmt, *args):
            if not self.path.startswith("/upload"):
                sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    return Handler


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--data", default=os.path.join(os.path.dirname(REPO), "boing-data"))
    a = ap.parse_args()
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except OSError:
        ip = "localhost"
    finally:
        s.close()
    print(f"Boing dev server: http://{ip}:{a.port}/  (APKs from {a.data}/apk, uploads to {a.data}/uploads)", flush=True)
    ThreadingHTTPServer(("0.0.0.0", a.port), make_handler(os.path.abspath(a.data))).serve_forever()


if __name__ == "__main__":
    main()
