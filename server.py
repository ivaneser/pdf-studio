#!/usr/bin/env python3
"""Простой HTTP-сервер для pdf-studio с правильными MIME-типами для ES-модулей."""
import http.server
import socketserver
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8087
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

# Правильные MIME-типы для ES-модулей — иначе браузер не загрузит import'ы
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".pdf": "application/pdf",
    ".map": "application/json; charset=utf-8",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def guess_type(self, path):  # noqa: D401 — переопределяем стандартный маппинг
        import posixpath

        ext = posixpath.splitext(path)[1].lower()
        return MIME_TYPES.get(ext, None)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
    print(f"Serving pdf-studio on http://localhost:{PORT} (dir={DIRECTORY})")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
