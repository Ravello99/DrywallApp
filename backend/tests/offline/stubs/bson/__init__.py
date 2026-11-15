import os, itertools
_counter = itertools.count(1)
class ObjectId:
    def __init__(self, v=None):
        if v is None: v = "%024x" % (0x650000000000000000000000 + next(_counter))
        if isinstance(v, ObjectId): v = v._v
        if not ObjectId.is_valid(v): raise ValueError("bad id %r" % v)
        self._v = v
    @staticmethod
    def is_valid(v):
        if isinstance(v, ObjectId): return True
        return isinstance(v, str) and len(v) == 24 and all(c in "0123456789abcdef" for c in v.lower())
    def __str__(self): return self._v
    def __repr__(self): return "ObjectId(%s)" % self._v
    def __eq__(self, o): return isinstance(o, ObjectId) and o._v == self._v
    def __hash__(self): return hash(self._v)
    def __lt__(self, o): return self._v < o._v
