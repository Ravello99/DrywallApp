class JWTError(Exception): pass
class jwt:
    @staticmethod
    def encode(d, *a, **k): return "tok:" + d["sub"]
    @staticmethod
    def decode(t, *a, **k): return {"sub": t.split(":", 1)[1]}
