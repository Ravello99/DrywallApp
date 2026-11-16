"""Tiny in-memory stand-in for Motor, enough for the app's queries."""
import copy, re
from bson import ObjectId

def _get(doc, path):
    cur = doc
    for p in path.split("."):
        if isinstance(cur, dict) and p in cur: cur = cur[p]
        elif isinstance(cur, list) and p.isdigit() and int(p) < len(cur): cur = cur[int(p)]
        else: return None
    return cur

def _match_cond(val, cond):
    if isinstance(cond, dict) and cond and all(k.startswith("$") for k in cond):
        for op, arg in cond.items():
            if op == "$in":
                vals = val if isinstance(val, list) else [val]
                if not any(v in arg for v in vals): return False
            elif op == "$nin":
                vals = val if isinstance(val, list) else [val]
                if any(v in arg for v in vals): return False
            elif op == "$ne":
                if isinstance(val, list):
                    if arg in val: return False
                elif val == arg: return False
            elif op == "$gt":
                if val is None or not val > arg: return False
            elif op == "$gte":
                if val is None or not val >= arg: return False
            elif op == "$lt":
                if val is None or not val < arg: return False
            elif op == "$regex":
                flags = re.I if "i" in cond.get("$options", "") else 0
                if val is None or not re.search(arg, str(val), flags): return False
            elif op == "$exists":
                if (val is not None) != bool(arg): return False
            elif op == "$options": pass
            else: raise NotImplementedError(op)
        return True
    if isinstance(val, list) and not isinstance(cond, list):
        return cond in val
    return val == cond

def matches(doc, q):
    for k, cond in (q or {}).items():
        if k == "$or":
            if not any(matches(doc, sub) for sub in cond): return False
            continue
        if not _match_cond(_get(doc, k), cond): return False
    return True

class Cursor:
    def __init__(self, docs): self.docs = docs; self._i = 0
    def sort(self, key, direction=None):
        keys = key if isinstance(key, list) else [(key, direction or 1)]
        for k, d in reversed(keys):
            self.docs.sort(key=lambda x: (_get(x, k) is None, _get(x, k) if _get(x, k) is not None else 0), reverse=(d == -1))
        return self
    def limit(self, n): self.docs = self.docs[:n]; return self
    async def to_list(self, n=None): return self.docs if n is None else self.docs[:n]
    def __aiter__(self): self._i = 0; return self
    async def __anext__(self):
        if self._i >= len(self.docs): raise StopAsyncIteration
        self._i += 1; return self.docs[self._i - 1]

class Result:
    def __init__(self, **kw): self.__dict__.update(kw)

class Collection:
    def __init__(self): self.docs = []
    def _find(self, q): return [d for d in self.docs if matches(d, q)]
    def find(self, q=None, projection=None):
        docs = [copy.deepcopy(d) for d in self._find(q)]
        if projection and any(v == 0 for v in projection.values()):
            for d in docs:
                for k, v in projection.items():
                    if v == 0: d.pop(k, None)
        return Cursor(docs)
    async def find_one(self, q=None, *a):
        r = self._find(q); return copy.deepcopy(r[0]) if r else None
    async def insert_one(self, doc):
        if "_id" not in doc: doc["_id"] = ObjectId()
        self.docs.append(copy.deepcopy(doc)); return Result(inserted_id=doc["_id"])
    async def count_documents(self, q): return len(self._find(q))
    def _apply(self, d, upd):
        for op, fields in upd.items():
            for k, v in fields.items():
                if op == "$set": d[k] = copy.deepcopy(v)
                elif op == "$unset": d.pop(k, None)
                elif op == "$push": d.setdefault(k, []).append(copy.deepcopy(v))
                elif op == "$addToSet":
                    d.setdefault(k, [])
                    if v not in d[k]: d[k].append(v)
                elif op == "$pull": d[k] = [x for x in d.get(k, []) if x != v]
                else: raise NotImplementedError(op)
    async def update_one(self, q, upd, upsert=False):
        r = self._find(q)
        if not r and upsert:
            d = {k: v for k, v in q.items() if not k.startswith("$")}; self._apply(d, upd); self.docs.append(d)
            return Result(matched_count=0, modified_count=0)
        if r: self._apply(r[0], upd)
        return Result(matched_count=len(r[:1]), modified_count=len(r[:1]))
    async def update_many(self, q, upd):
        r = self._find(q)
        for d in r: self._apply(d, upd)
        return Result(matched_count=len(r), modified_count=len(r))
    async def delete_one(self, q):
        r = self._find(q)
        if r: self.docs.remove(r[0])
        return Result(deleted_count=len(r[:1]))
    async def delete_many(self, q):
        r = self._find(q)
        for d in r: self.docs.remove(d)
        return Result(deleted_count=len(r))
    async def create_index(self, *a, **k): return "ix"

class DB:
    def __init__(self): self._c = {}
    def __getattr__(self, n):
        if n.startswith("_"): raise AttributeError(n)
        return self[n]
    def __getitem__(self, n): return self._c.setdefault(n, Collection())
    async def command(self, *a): return {"ok": 1}

class AsyncIOMotorClient:
    def __init__(self, *a, **k): self._dbs = {}
    def __getitem__(self, n): return self._dbs.setdefault(n, DB())
    def close(self): pass
