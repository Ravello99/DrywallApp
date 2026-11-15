class HTTPException(Exception):
    def __init__(self, status_code=500, detail=None):
        super().__init__(detail); self.status_code = status_code; self.detail = detail
class _Dep:
    def __init__(self, dep): self.dep = dep
def Depends(dep=None): return _Dep(dep)
def Query(default=None, **kw): return default
def File(*a, **k): return None
class UploadFile: pass
class status: HTTP_401_UNAUTHORIZED = 401
class _Router:
    def __init__(self, *a, **k): self.routes = []
    def _reg(self, method, path, **k):
        def deco(fn): self.routes.append((method, path, fn)); return fn
        return deco
    def get(self, p, **k): return self._reg("GET", p)
    def post(self, p, **k): return self._reg("POST", p)
    def put(self, p, **k): return self._reg("PUT", p)
    def delete(self, p, **k): return self._reg("DELETE", p)
    def include_router(self, r, **k): self.routes += getattr(r, "routes", [])
class APIRouter(_Router): pass
class FastAPI(_Router):
    def on_event(self, name):
        def deco(fn): setattr(self, "on_" + name, fn); return fn
        return deco
    def add_middleware(self, *a, **k): pass
