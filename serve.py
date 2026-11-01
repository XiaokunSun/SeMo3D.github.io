# 本地预览服务器（只用 Python 标准库）：
#   python serve.py          然后浏览器打开 http://localhost:8000
#   python serve.py 8080     换端口
# 3D 查看器需要通过 http 加载模型，不能双击 index.html 打开；这里额外支持视频的 Range 请求（循环 / 拖动更稳定）。
import http.server
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.js': 'text/javascript',
        '.mjs': 'text/javascript', '.webp': 'image/webp', '.mp4': 'video/mp4', '.ply': 'application/octet-stream',
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def send_head(self):
        self._remaining = None
        path = self.translate_path(self.path)
        m = re.match(r'bytes=(\d*)-(\d*)$', self.headers.get('Range', ''))
        if not m or not os.path.isfile(path) or not (m.group(1) or m.group(2)):
            return super().send_head()
        size = os.path.getsize(path)
        if m.group(1):
            start = int(m.group(1))
            end = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
        else:
            start, end = max(0, size - int(m.group(2))), size - 1
        if start >= size or start > end:
            self.send_error(416)
            return None
        f = open(path, 'rb')
        f.seek(start)
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        self._remaining = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        try:
            if self._remaining is None:
                return super().copyfile(source, outputfile)
            n = self._remaining
            while n > 0:
                buf = source.read(min(1 << 16, n))
                if not buf:
                    break
                outputfile.write(buf)
                n -= len(buf)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # 浏览器切换视频时会主动断开连接，属正常现象

    def log_message(self, fmt, *args):
        if len(args) > 1 and str(args[1]).startswith(('4', '5')):  # 只打印出错的请求
            super().log_message(fmt, *args)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(f'SeMo3D 项目页本地预览：http://localhost:{port}/   （Ctrl+C 停止）')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
