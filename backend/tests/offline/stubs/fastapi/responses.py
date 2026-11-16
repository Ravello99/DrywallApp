class StreamingResponse:
    def __init__(self, *a, **k): pass
class FileResponse:
    def __init__(self, *a, **k): pass
class HTMLResponse:
    def __init__(self, content="", headers=None, **k): self.body = content; self.headers = headers or {}
