"""Tasks, scope workflows and hour budgets.

A PM applies a workflow to a project (e.g. Steel Stud Framing, 600 h), which creates the
standard tasks with the hours split between them. Crew pick the task they're on when they
clock in, so each task's actual hours and labour cost are known and tasks running over their
budget are flagged automatically."""
from collections import defaultdict
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import logic as L
from core import (OFFICE_ROLES, PAY_RATE_VIEWERS, ROLE_ADMIN, ROLE_FOREMAN, ROLE_PM, db, ensure_site_access,
                  get_current_user, get_site_or_404, is_foreman, is_office, notify, oid, require_roles,
                  site_filter)

router = APIRouter(prefix="/api", tags=["tasks"])

TASK_STATUSES = ["todo", "in_progress", "complete"]
PRIORITIES = ["high", "medium", "low"]
TASK_TYPES = ["installation", "safety", "inspection", "deficiency", "other"]


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    site_id: str
    assigned_to: Optional[str] = None        # user id; empty = crew task
    priority: str = "medium"
    task_type: str = "installation"
    scope: Optional[str] = None
    budget_hours: Optional[float] = Field(default=None, ge=0)
    start_date: Optional[str] = None
    due_date: Optional[str] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    assigned_to: Optional[str] = None
    priority: Optional[str] = None
    task_type: Optional[str] = None
    status: Optional[str] = None
    scope: Optional[str] = None
    budget_hours: Optional[float] = Field(default=None, ge=0)
    progress_pct: Optional[int] = Field(default=None, ge=0, le=100)
    start_date: Optional[str] = None
    due_date: Optional[str] = None


class WorkflowScope(BaseModel):
    scope: str
    budget_hours: float = Field(ge=0)


class ApplyWorkflow(BaseModel):
    scopes: List[WorkflowScope]


def _validate(data: dict) -> dict:
    if data.get("status") and data["status"] not in TASK_STATUSES:
        raise HTTPException(status_code=400, detail="Unknown status")
    if data.get("priority") and data["priority"] not in PRIORITIES:
        raise HTTPException(status_code=400, detail="Unknown priority")
    if data.get("task_type") and data["task_type"] not in TASK_TYPES:
        raise HTTPException(status_code=400, detail="Unknown task type")
    if data.get("scope") and data["scope"] not in L.SCOPES:
        raise HTTPException(status_code=400, detail="Unknown scope")
    return data


async def hours_by_task(task_ids: List[str]) -> dict:
    """{task_id: (hours, cost_cents)} from clock records."""
    if not task_ids:
        return {}
    grouped = defaultdict(list)
    async for r in db.clock_records.find({"task_id": {"$in": task_ids}},
                                         {"task_id": 1, "total_hours": 1, "clock_in": 1, "clock_out": 1,
                                          "pay_rate": 1}):
        grouped[r["task_id"]].append(r)
    now = datetime.utcnow()
    return {tid: L.labour_totals(recs, now) for tid, recs in grouped.items()}


def task_out(t: dict, hours: dict, viewer: dict) -> dict:
    h, cost = hours.get(str(t["_id"]), (0.0, 0))
    status = L.budget_status(t.get("budget_hours"), h)
    d = {
        "id": str(t["_id"]),
        "title": t["title"],
        "description": t.get("description"),
        "site_id": t["site_id"],
        "site_name": t.get("site_name", ""),
        "assigned_to": t.get("assigned_to"),
        "assigned_to_name": t.get("assigned_to_name"),
        "priority": t.get("priority", "medium"),
        "task_type": t.get("task_type", "installation"),
        "status": t.get("status", "todo"),
        "scope": t.get("scope"),
        "scope_label": L.SCOPES.get(t.get("scope") or "", None),
        "sequence": t.get("sequence"),
        "budget_hours": t.get("budget_hours"),
        "actual_hours": h,
        "budget_status": status,
        "hours_remaining": round(t["budget_hours"] - h, 1) if t.get("budget_hours") else None,
        "progress_pct": t.get("progress_pct", 100 if t.get("status") == "complete" else 0),
        "start_date": t.get("start_date"),
        "due_date": t.get("due_date"),
        "created_by": t.get("created_by"),
        "created_by_name": t.get("created_by_name"),
        "created_at": t.get("created_at"),
        "updated_at": t.get("updated_at"),
    }
    if viewer.get("role") in PAY_RATE_VIEWERS:
        d["labour_cost"] = L.to_dollars(cost)
    return d


async def tasks_out(tasks: List[dict], viewer: dict) -> List[dict]:
    hours = await hours_by_task([str(t["_id"]) for t in tasks])
    return [task_out(t, hours, viewer) for t in tasks]


async def _assignee(user_id: Optional[str]):
    if not user_id:
        return None, None
    u = await db.users.find_one({"_id": oid(user_id, "User")})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return str(u["_id"]), u["name"]


# ---------------------------------------------------------------- workflows

@router.get("/workflows/templates")
async def workflow_templates(current_user: dict = Depends(get_current_user)):
    return {
        "scopes": [{"value": k, "label": v, "specialty": L.SCOPE_SPECIALTY.get(k)} for k, v in L.SCOPES.items()],
        "templates": {k: [{"title": t, "share": s} for t, s in v] for k, v in L.WORKFLOW_TEMPLATES.items()},
    }


@router.post("/sites/{site_id}/workflows")
async def apply_workflow(site_id: str, body: ApplyWorkflow,
                         current_user: dict = Depends(require_roles(ROLE_ADMIN, ROLE_PM))):
    """Create the standard tasks for each scope, splitting its budget hours between them."""
    site = await get_site_or_404(site_id)
    created = []
    now = datetime.utcnow()
    for item in body.scopes:
        try:
            planned = L.build_workflow_tasks(item.scope, item.budget_hours)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        for p in planned:
            doc = {**p, "site_id": site_id, "site_name": site["name"], "status": "todo", "progress_pct": 0,
                   "priority": "medium", "task_type": "installation", "assigned_to": None,
                   "assigned_to_name": None, "created_by": str(current_user["_id"]),
                   "created_by_name": current_user["name"], "created_at": now}
            res = await db.tasks.insert_one(doc)
            doc["_id"] = res.inserted_id
            created.append(doc)
    return {"created": len(created), "tasks": await tasks_out(created, current_user)}


# ---------------------------------------------------------------- tasks

@router.post("/tasks")
async def create_task(body: TaskCreate, current_user: dict = Depends(require_roles(*OFFICE_ROLES, ROLE_FOREMAN))):
    data = _validate(body.model_dump())
    site = await get_site_or_404(data["site_id"])
    ensure_site_access(current_user, data["site_id"])
    if is_foreman(current_user) and data.get("budget_hours"):
        data["budget_hours"] = None   # budgets are set by the office
    data["assigned_to"], data["assigned_to_name"] = await _assignee(data.get("assigned_to"))
    data.update({"site_name": site["name"], "status": "todo", "progress_pct": 0,
                 "created_by": str(current_user["_id"]), "created_by_name": current_user["name"],
                 "created_at": datetime.utcnow(), "updated_at": None})
    res = await db.tasks.insert_one(data)
    data["_id"] = res.inserted_id
    if data["assigned_to"] and data["assigned_to"] != str(current_user["_id"]):
        await notify([data["assigned_to"]], "New task: " + data["title"], site["name"], kind="task",
                     link="/worker/tasks")
    return (await tasks_out([data], current_user))[0]


@router.get("/tasks/my-tasks")
async def my_tasks(current_user: dict = Depends(get_current_user)):
    tasks = await db.tasks.find({"assigned_to": str(current_user["_id"])}).sort("created_at", -1).to_list(1000)
    return await tasks_out(tasks, current_user)


@router.get("/tasks/clockable/{site_id}")
async def clockable_tasks(site_id: str, current_user: dict = Depends(get_current_user)):
    """Open tasks on a site, for the 'what are you working on?' picker at clock-in."""
    ensure_site_access(current_user, site_id)
    tasks = await db.tasks.find({"site_id": site_id, "status": {"$ne": "complete"}}) \
        .sort([("scope", 1), ("sequence", 1), ("title", 1)]).to_list(500)
    return [{"id": str(t["_id"]), "title": t["title"], "scope_label": L.SCOPES.get(t.get("scope") or "")}
            for t in tasks]


@router.get("/tasks")
async def list_tasks(site_id: Optional[str] = Query(None), assigned_to: Optional[str] = Query(None),
                     scope: Optional[str] = Query(None), status: Optional[str] = Query(None),
                     budget: Optional[str] = Query(None, description="warning|over"),
                     current_user: dict = Depends(get_current_user)):
    if not is_office(current_user) and not is_foreman(current_user):
        return await my_tasks(current_user)
    q = site_filter(current_user, site_id)
    if assigned_to:
        q["assigned_to"] = assigned_to
    if scope:
        q["scope"] = scope
    if status:
        q["status"] = status
    tasks = await db.tasks.find(q).sort([("site_name", 1), ("scope", 1), ("sequence", 1),
                                         ("created_at", -1)]).to_list(5000)
    result = await tasks_out(tasks, current_user)
    if budget == "over":
        result = [t for t in result if t["budget_status"] == "over"]
    elif budget == "warning":
        result = [t for t in result if t["budget_status"] in ("warning", "over")]
    return result


@router.put("/tasks/{task_id}")
async def update_task(task_id: str, body: TaskUpdate, current_user: dict = Depends(get_current_user)):
    task = await db.tasks.find_one({"_id": oid(task_id, "Task")})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    data = _validate({k: v for k, v in body.model_dump().items() if v is not None})
    me = str(current_user["_id"])
    if is_office(current_user):
        pass
    elif is_foreman(current_user):
        ensure_site_access(current_user, task["site_id"])
        data.pop("budget_hours", None)   # office sets budgets
    else:
        if task.get("assigned_to") != me:
            raise HTTPException(status_code=403, detail="You can only update your own tasks")
        data = {k: v for k, v in data.items() if k in ("status", "progress_pct")}
    if "assigned_to" in data:
        data["assigned_to"], data["assigned_to_name"] = await _assignee(data["assigned_to"])
    if data.get("status") == "complete":
        data["progress_pct"] = 100
        data["completed_at"] = datetime.utcnow()
    elif data.get("progress_pct") == 100 and "status" not in data:
        data["status"] = "complete"
        data["completed_at"] = datetime.utcnow()
    elif data.get("progress_pct", 0) > 0 and task.get("status") == "todo" and "status" not in data:
        data["status"] = "in_progress"
    data["updated_at"] = datetime.utcnow()
    await db.tasks.update_one({"_id": task["_id"]}, {"$set": data})
    updated = await db.tasks.find_one({"_id": task["_id"]})
    return (await tasks_out([updated], current_user))[0]


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, current_user: dict = Depends(require_roles(*OFFICE_ROLES))):
    res = await db.tasks.delete_one({"_id": oid(task_id, "Task")})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    await db.clock_records.update_many({"task_id": task_id}, {"$set": {"task_id": None}})
    return {"message": "Task deleted"}


@router.put("/clock/active/task")
async def set_active_task(task_id: Optional[str] = Query(None), current_user: dict = Depends(get_current_user)):
    """Change what you're working on while clocked in (hours of this shift go to that task)."""
    rec = await db.clock_records.find_one({"user_id": str(current_user["_id"]), "status": "clocked_in"})
    if not rec:
        raise HTTPException(status_code=400, detail="You're not clocked in")
    task = None
    if task_id:
        task = await db.tasks.find_one({"_id": oid(task_id, "Task"), "site_id": rec["site_id"]})
        if not task:
            raise HTTPException(status_code=404, detail="That task isn't on this site")
    await db.clock_records.update_one({"_id": rec["_id"]}, {"$set": {
        "task_id": str(task["_id"]) if task else None, "task_title": task["title"] if task else None}})
    return {"task_id": str(task["_id"]) if task else None, "task_title": task["title"] if task else None}
