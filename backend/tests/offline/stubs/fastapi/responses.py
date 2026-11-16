class StreamingResponse:
    def __init__(self, content=None, media_type=None, headers=None, **k):
        self.body = content.read() if hasattr(content, "read") else content
        self.media_type = media_type; self.headers = headers or {}
class FileResponse:
    def __init__(self, *a, **k): pass
class HTMLResponse:
    def __init__(self, content="", headers=None, **k): self.body = content; self.headers = headers or {}
