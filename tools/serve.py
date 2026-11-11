"""
本地开发服务器：静态服务 dist/ + /__version 用于页面自动刷新。
用法： python serve.py [port]
"""
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8770


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=DIST, **kw)

    def do_GET(self):
        if self.path.startswith("/__version"):
            target = os.path.join(DIST, "index.html")
            try:
                v = str(os.path.getmtime(target))
            except OSError:
                v = "0"
            body = v.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        # 静态资源也不缓存，避免改了看不到
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    os.makedirs(DIST, exist_ok=True)
    with Server(("127.0.0.1", PORT), Handler) as httpd:
        print("serving %s at http://127.0.0.1:%d/" % (DIST, PORT), flush=True)
        httpd.serve_forever()
