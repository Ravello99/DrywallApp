import base64, json
from datetime import datetime
class JWTError(Exception): pass
def _default(o):
    if isinstance(o, datetime): return o.timestamp()
    raise TypeError
class jwt:
    @staticmethod
    def encode(d, key, algorithm=None):
        return "tok." + base64.urlsafe_b64encode(json.dumps({**d, "_k": key}, default=_default).encode()).decode()
    @staticmethod
    def decode(t, key, algorithms=None):
        try:
            d = json.loads(base64.urlsafe_b64decode(t.split(".", 1)[1]))
        except Exception:
            raise JWTError("bad token")
        if d.pop("_k", None) != key: raise JWTError("bad signature")
        if "exp" in d and d["exp"] < datetime.utcnow().timestamp(): raise JWTError("expired")
        return d
