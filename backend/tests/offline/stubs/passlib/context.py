class CryptContext:
    def __init__(self, *a, **k): pass
    def hash(self, p): return "h:" + p
    def verify(self, p, h): return h == "h:" + p
