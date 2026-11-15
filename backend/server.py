from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, File, UploadFile, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from bson import ObjectId
import os
import logging
from pathlib import Path
import io
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
import base64


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Security
# SECRET_KEY must come from the environment (run.py generates one into backend/.env).
# There is deliberately no hardcoded fallback: a known secret lets anyone forge login tokens.
SECRET_KEY = os.environ.get("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY is not set. Start the app with run.py, or add SECRET_KEY to backend/.env"
    )
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30 * 24 * 60  # 30 days

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app
app = FastAPI(title="VanGuard Drywall & Acoustics API")
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ============ MODELS ============

class PyObjectId(ObjectId):
    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v):
        if not ObjectId.is_valid(v):
            raise ValueError("Invalid ObjectId")
        return ObjectId(v)

    @classmethod
    def __get_pydantic_json_schema__(cls, field_schema):
        field_schema.update(type="string")


class LocationModel(BaseModel):
    latitude: float
    longitude: float


# ---------- Roles ----------
# Office roles use the management screens; field roles use the crew screens.
ROLE_ADMIN = "admin"                     # owner / office admin: everything
ROLE_COORDINATOR = "project_coordinator"  # bids, invoicing, job shutdown
ROLE_ESTIMATOR = "estimator"             # bids and estimating
ROLE_PM = "project_manager"              # projects, crews, materials, approvals
ROLE_FOREMAN = "foreman"                 # runs a job site
ROLE_EMPLOYEE = "employee"               # crew member

ALL_ROLES = [ROLE_ADMIN, ROLE_COORDINATOR, ROLE_ESTIMATOR, ROLE_PM, ROLE_FOREMAN, ROLE_EMPLOYEE]
OFFICE_ROLES = {ROLE_ADMIN, ROLE_COORDINATOR, ROLE_ESTIMATOR, ROLE_PM}
FIELD_ROLES = {ROLE_FOREMAN, ROLE_EMPLOYEE}
PAY_RATE_VIEWERS = {ROLE_ADMIN, ROLE_PM, ROLE_COORDINATOR}   # who may see/edit pay rates
SHUTDOWN_ROLES = {ROLE_ADMIN, ROLE_COORDINATOR, ROLE_PM}     # who may shut a job site down

# Roles from the Oakdale app, mapped on startup. Old crew levels become the "level" field.
LEGACY_ROLES = {"manager": (ROLE_ADMIN, None), "apprentice": (ROLE_EMPLOYEE, "apprentice"),
                "journeyman": (ROLE_EMPLOYEE, "journeyman"), "lead_hand": (ROLE_EMPLOYEE, "lead_hand")}

SPECIALTIES = ["steel_framer", "drywaller", "taper_finisher", "insulator", "acoustic_ceilings",
               "labourer", "general"]
LEVELS = ["apprentice", "journeyman", "lead_hand"]


class UserBase(BaseModel):
    email: EmailStr
    name: str
    role: str = Field(default=ROLE_EMPLOYEE)


class UserProfileFields(BaseModel):
    phone: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    specialties: Optional[List[str]] = None
    level: Optional[str] = None
    hire_date: Optional[str] = None
    pay_rate: Optional[float] = None          # hourly, dollars
    active: Optional[bool] = None


class UserCreate(UserBase, UserProfileFields):
    password: str
    assigned_sites: List[str] = Field(default_factory=list)


class UserUpdate(UserProfileFields):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    assigned_sites: Optional[List[str]] = None
    password: Optional[str] = None
    role: Optional[str] = None


class UserResponse(UserBase, UserProfileFields):
    id: str
    assigned_sites: List[str] = Field(default_factory=list)
    created_at: datetime

    class Config:
        populate_by_name = True


def user_out(u: dict, viewer: Optional[dict] = None) -> UserResponse:
    """Build the API view of a user. Pay rate is only included for roles allowed to see it
    (and for the person themselves)."""
    can_see_pay = viewer is not None and (
        viewer.get("role") in PAY_RATE_VIEWERS or str(viewer.get("_id")) == str(u.get("_id")))
    return UserResponse(
        id=str(u["_id"]),
        email=u["email"],
        name=u["name"],
        role=u.get("role", ROLE_EMPLOYEE),
        assigned_sites=u.get("assigned_sites", []),
        created_at=u["created_at"],
        phone=u.get("phone"),
        emergency_contact_name=u.get("emergency_contact_name"),
        emergency_contact_phone=u.get("emergency_contact_phone"),
        specialties=u.get("specialties") or [],
        level=u.get("level"),
        hire_date=u.get("hire_date"),
        pay_rate=u.get("pay_rate") if can_see_pay else None,
        active=u.get("active", True),
    )


def validate_user_fields(data: dict, viewer: dict) -> dict:
    if "role" in data and data["role"] not in ALL_ROLES:
        raise HTTPException(status_code=400, detail="Unknown role: %s" % data["role"])
    if data.get("role") == ROLE_ADMIN and viewer.get("role") != ROLE_ADMIN:
        raise HTTPException(status_code=403, detail="Only an admin can create or promote admins")
    if "specialties" in data and data["specialties"] is not None:
        bad = [x for x in data["specialties"] if x not in SPECIALTIES]
        if bad:
            raise HTTPException(status_code=400, detail="Unknown specialty: %s" % ", ".join(bad))
    if data.get("level") and data["level"] not in LEVELS:
        raise HTTPException(status_code=400, detail="Unknown level: %s" % data["level"])
    if "pay_rate" in data and data["pay_rate"] is not None:
        if viewer.get("role") not in PAY_RATE_VIEWERS:
            raise HTTPException(status_code=403, detail="You can't set pay rates")
        if data["pay_rate"] < 0:
            raise HTTPException(status_code=400, detail="Pay rate can't be negative")
    if "email" in data and data["email"]:
        data["email"] = str(data["email"]).lower()
    return data


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse


SITE_STATUSES = ["active", "shutdown", "completed"]
JOB_TYPES = ["multi_family", "commercial_fit_out", "institutional", "other"]
DEFAULT_GEOFENCE_M = 200


class SiteCreate(BaseModel):
    name: str
    address: str
    location: Optional[LocationModel] = None
    geofence_radius_m: int = Field(default=DEFAULT_GEOFENCE_M, ge=25, le=5000)
    status: str = Field(default="active")
    project_number: Optional[str] = None
    general_contractor: Optional[str] = None
    job_type: Optional[str] = None
    contract_value: Optional[float] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class SiteUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    location: Optional[LocationModel] = None
    geofence_radius_m: Optional[int] = Field(default=None, ge=25, le=5000)
    status: Optional[str] = None
    project_number: Optional[str] = None
    general_contractor: Optional[str] = None
    job_type: Optional[str] = None
    contract_value: Optional[float] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class SiteResponse(SiteCreate):
    id: str
    created_at: datetime
    shutdown_reason: Optional[str] = None
    shutdown_at: Optional[datetime] = None
    shutdown_by_name: Optional[str] = None
    workers_on_site: int = 0


class ShutdownRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
    clock_out_everyone: bool = True


class ClockInRequest(BaseModel):
    site_id: str
    location: LocationModel
    accuracy_m: Optional[float] = None   # GPS accuracy reported by the phone


class ClockOutRequest(BaseModel):
    location: LocationModel
    accuracy_m: Optional[float] = None


class ClockRecordResponse(BaseModel):
    id: str
    user_id: str
    user_name: str
    site_id: str
    site_name: str
    clock_in: datetime
    clock_in_location: LocationModel
    clock_out: Optional[datetime] = None
    clock_out_location: Optional[LocationModel] = None
    total_hours: Optional[float] = None
    status: str
    synced: bool = Field(default=True)
    clock_in_distance_m: Optional[float] = None
    clock_out_distance_m: Optional[float] = None
    flagged: bool = False
    flag_reason: Optional[str] = None
    auto_clock_out_reason: Optional[str] = None


class SafetyDocumentCreate(BaseModel):
    site_id: str
    document_type: str  # "photo" or "pdf"
    file_data: str  # base64 encoded
    file_name: str
    description: Optional[str] = None
    expiry_date: Optional[str] = None  # ISO format date string


class SafetyDocumentResponse(BaseModel):
    id: str
    user_id: str
    user_name: str
    site_id: str
    site_name: str
    document_type: str
    file_data: str
    file_name: str
    description: Optional[str] = None
    expiry_date: Optional[str] = None
    is_expiring_soon: bool = False
    is_expiring_critical: bool = False
    days_until_expiry: Optional[int] = None
    created_at: datetime


class AnnouncementType(str):
    SITE_INSTRUCTION = "site_instruction"
    HAZARD = "hazard"
    GENERAL = "general"


class AnnouncementCreate(BaseModel):
    site_id: str
    title: str
    content: str
    announcement_type: str = Field(default="general")


class AnnouncementUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    announcement_type: Optional[str] = None


class AnnouncementResponse(BaseModel):
    id: str
    site_id: str
    site_name: str
    title: str
    content: str
    announcement_type: str
    created_by: str
    created_by_name: str
    created_at: datetime
    updated_at: Optional[datetime] = None


class FileShareCategory(str):
    DRAWINGS = "drawings"
    SHOP_DRAWINGS = "shop_drawings"
    SITE_PLANS = "site_plans"
    SAFETY_DOCUMENTS = "safety_documents"
    OTHER = "other"


class SharedFileCreate(BaseModel):
    site_id: str
    category: str
    file_name: str
    file_data: str  # base64 encoded
    description: Optional[str] = None


class SharedFileResponse(BaseModel):
    id: str
    site_id: str
    site_name: str
    category: str
    file_name: str
    file_data: str
    description: Optional[str] = None
    uploaded_by: str
    uploaded_by_name: str
    created_at: datetime


class SyncDataRequest(BaseModel):
    clock_records: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    safety_documents: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    last_sync: Optional[str] = None


class SyncDataResponse(BaseModel):
    success: bool
    synced_clock_records: int
    synced_safety_documents: int
    new_data: Dict[str, Any]


# ============ TASK MODELS ============

class TaskPriority(str):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class TaskType(str):
    SAFETY = "safety"
    INSTALLATION = "installation"
    INSPECTION = "inspection"


class TaskStatus(str):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    COMPLETE = "complete"


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    site_id: str
    assigned_to: str  # user_id
    priority: str = Field(default="medium")
    task_type: str = Field(default="safety")
    due_date: Optional[str] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    task_type: Optional[str] = None
    status: Optional[str] = None
    due_date: Optional[str] = None


class TaskResponse(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    site_id: str
    site_name: str
    assigned_to: str
    assigned_to_name: str
    priority: str
    task_type: str
    status: str
    due_date: Optional[str] = None
    created_by: str
    created_by_name: str
    created_at: datetime
    updated_at: Optional[datetime] = None


# ============ CUSTOM FORM MODELS ============

class FormFieldType(str):
    TEXT = "text"
    YESNO = "yesno"
    MULTIPLE_CHOICE = "multiple_choice"
    DATE = "date"
    PHOTO = "photo"
    SIGNATURE = "signature"


class FormField(BaseModel):
    field_id: str
    field_type: str
    label: str
    required: bool = False
    options: Optional[List[str]] = None  # For multiple choice


class FormTemplateCreate(BaseModel):
    title: str
    description: Optional[str] = None
    fields: List[FormField]
    site_id: Optional[str] = None  # Optional: can be site-specific or general


class FormTemplateResponse(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    fields: List[FormField]
    site_id: Optional[str] = None
    site_name: Optional[str] = None
    created_by: str
    created_by_name: str
    created_at: datetime


class FormAssignment(BaseModel):
    form_id: str
    assigned_to: List[str]  # List of user_ids
    due_date: Optional[str] = None


class FormResponse(BaseModel):
    form_id: str
    responses: Dict[str, Any]  # field_id -> response value


class FormSubmissionResponse(BaseModel):
    id: str
    form_id: str
    form_title: str
    user_id: str
    user_name: str
    responses: Dict[str, Any]
    submitted_at: datetime


# ============ AUTHENTICATION HELPERS ============

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password):
    return pwd_context.hash(password)


def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    
    return user


def is_office(user: dict) -> bool:
    return user.get("role") in OFFICE_ROLES


async def get_current_office_user(current_user: dict = Depends(get_current_user)):
    if not is_office(current_user):
        raise HTTPException(status_code=403, detail="Not authorized. Office access required.")
    return current_user


# Older endpoints use this name; "manager" now means any office role.
get_current_manager = get_current_office_user


def require_roles(*roles: str):
    allowed = set(roles)

    async def checker(current_user: dict = Depends(get_current_user)):
        if current_user.get("role") not in allowed:
            raise HTTPException(status_code=403, detail="You don't have permission to do that.")
        return current_user
    return checker


def can_access_site(user: dict, site_id: str) -> bool:
    return is_office(user) or site_id in (user.get("assigned_sites") or [])


def distance_m(a: dict, b: dict) -> float:
    """Great-circle distance in metres between two {latitude, longitude} points."""
    from math import radians, sin, cos, asin, sqrt
    lat1, lon1, lat2, lon2 = map(radians, [a["latitude"], a["longitude"], b["latitude"], b["longitude"]])
    h = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371000 * asin(sqrt(h))


def geofence_check(site: dict, location: dict, accuracy_m: Optional[float]):
    """Returns (ok, distance_m, message). A site with no GPS location set can't be checked,
    so clock-in is allowed but the record is flagged for the office."""
    if not site.get("location"):
        return True, None, "Site has no GPS location set"
    d = distance_m(site["location"], location)
    radius = site.get("geofence_radius_m") or DEFAULT_GEOFENCE_M
    slack = min(max(accuracy_m or 0, 0), 50)   # forgive up to 50 m of GPS inaccuracy
    if d > radius + slack:
        return False, round(d), ("You're about %s from %s. You need to be within %d m of the site to clock in."
                                 % (format_distance(d), site["name"], radius))
    return True, round(d), None


def format_distance(d: float) -> str:
    return "%d m" % round(d) if d < 1000 else "%.1f km" % (d / 1000)


def calculate_expiry_info(expiry_date_str: Optional[str]) -> tuple:
    """Calculate if document is expiring soon and days until expiry"""
    if not expiry_date_str:
        return False, False, None
    
    try:
        expiry_date = datetime.fromisoformat(expiry_date_str.replace('Z', '+00:00'))
        today = datetime.now(expiry_date.tzinfo) if expiry_date.tzinfo else datetime.now()
        days_until_expiry = (expiry_date - today).days
        
        # 14 days: employee gets a two-week notice. 7 days (or expired): foreman is warned.
        is_expiring_critical = days_until_expiry <= 7
        is_expiring_soon = 7 < days_until_expiry <= 14
        
        return is_expiring_soon, is_expiring_critical, days_until_expiry
    except:
        return False, False, None


def serialize_doc(doc):
    """Convert MongoDB document to JSON serializable format"""
    if doc is None:
        return None
    doc["id"] = str(doc.pop("_id"))
    return doc


# ============ AUTH ROUTES ============


# ============ HEALTH CHECK ============
@api_router.get("/health")
async def health_check():
    """Health check endpoint for deployment readiness"""
    try:
        # Check MongoDB connection
        await db.command("ping")
        return {
            "status": "healthy",
            "database": "connected",
            "service": "drywall-management-api",
            "version": "2.0.0-dev"
        }
    except Exception:
        logger.exception("Health check: database ping failed")
        return {
            "status": "unhealthy",
            "database": "disconnected",
        }


@api_router.post("/auth/login", response_model=Token)
async def login(login_data: LoginRequest):
    user = await db.users.find_one({"email": login_data.email.lower()})
    if not user or not verify_password(login_data.password, user["password"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    if user.get("active") is False:
        raise HTTPException(status_code=403, detail="This account has been deactivated")
    access_token = create_access_token(data={"sub": str(user["_id"])})
    return Token(access_token=access_token, token_type="bearer", user=user_out(user, user))


@api_router.get("/auth/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    return user_out(current_user, current_user)


# ============ USER MANAGEMENT ROUTES (office only) ============

@api_router.get("/users", response_model=List[UserResponse])
async def get_users(current_user: dict = Depends(get_current_office_user)):
    users = await db.users.find().sort("name", 1).to_list(5000)
    return [user_out(u, current_user) for u in users if str(u["_id"]) != str(current_user["_id"])]


@api_router.get("/users/meta")
async def get_user_meta(current_user: dict = Depends(get_current_user)):
    """Lists of roles, specialties and levels for the app's pickers."""
    return {"roles": ALL_ROLES, "office_roles": sorted(OFFICE_ROLES), "specialties": SPECIALTIES,
            "levels": LEVELS, "can_see_pay_rates": current_user.get("role") in PAY_RATE_VIEWERS}


@api_router.post("/users", response_model=UserResponse)
async def create_user(user_data: UserCreate, current_user: dict = Depends(get_current_office_user)):
    data = validate_user_fields(user_data.model_dump(), current_user)
    if await db.users.find_one({"email": data["email"]}):
        raise HTTPException(status_code=400, detail="User with this email already exists")
    if len(data["password"]) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    data["password"] = get_password_hash(data["password"])
    data["created_at"] = datetime.utcnow()
    data["active"] = True if data.get("active") is None else data["active"]
    data["specialties"] = data.get("specialties") or []
    if data["role"] in OFFICE_ROLES:
        data["assigned_sites"] = []
    result = await db.users.insert_one(data)
    return user_out(await db.users.find_one({"_id": result.inserted_id}), current_user)


@api_router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(user_id: str, user_data: UserUpdate, current_user: dict = Depends(get_current_office_user)):
    target = await db.users.find_one({"_id": ObjectId(user_id)})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") == ROLE_ADMIN and current_user.get("role") != ROLE_ADMIN:
        raise HTTPException(status_code=403, detail="Only an admin can edit an admin")
    update = {k: v for k, v in user_data.model_dump().items() if v is not None}
    update = validate_user_fields(update, current_user)
    if "email" in update and await db.users.find_one({"email": update["email"], "_id": {"$ne": target["_id"]}}):
        raise HTTPException(status_code=400, detail="Another user already has this email")
    if "password" in update:
        if len(update["password"]) < 8:
            raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
        update["password"] = get_password_hash(update["password"])
    if update.get("role") in OFFICE_ROLES:
        update["assigned_sites"] = []
    if update:
        await db.users.update_one({"_id": target["_id"]}, {"$set": update})
    return user_out(await db.users.find_one({"_id": target["_id"]}), current_user)


@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, current_user: dict = Depends(get_current_office_user)):
    target = await db.users.find_one({"_id": ObjectId(user_id)})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") == ROLE_ADMIN and current_user.get("role") != ROLE_ADMIN:
        raise HTTPException(status_code=403, detail="Only an admin can delete an admin")
    await db.users.delete_one({"_id": target["_id"]})
    return {"message": "User deleted successfully"}


# ============ SITE (PROJECT) ROUTES ============

async def site_out(s_: dict) -> SiteResponse:
    on_site = await db.clock_records.count_documents({"site_id": str(s_["_id"]), "status": "clocked_in"})
    return SiteResponse(
        id=str(s_["_id"]),
        name=s_["name"],
        address=s_["address"],
        location=s_.get("location"),
        geofence_radius_m=s_.get("geofence_radius_m") or DEFAULT_GEOFENCE_M,
        status=s_.get("status", "active"),
        project_number=s_.get("project_number"),
        general_contractor=s_.get("general_contractor"),
        job_type=s_.get("job_type"),
        contract_value=s_.get("contract_value"),
        start_date=s_.get("start_date"),
        end_date=s_.get("end_date"),
        created_at=s_["created_at"],
        shutdown_reason=s_.get("shutdown_reason"),
        shutdown_at=s_.get("shutdown_at"),
        shutdown_by_name=s_.get("shutdown_by_name"),
        workers_on_site=on_site,
    )


def validate_site_fields(data: dict) -> dict:
    if data.get("status") and data["status"] not in SITE_STATUSES:
        raise HTTPException(status_code=400, detail="Unknown status")
    if data.get("status") == "shutdown":
        raise HTTPException(status_code=400, detail="Use the Shut Down action so a reason is recorded")
    if data.get("job_type") and data["job_type"] not in JOB_TYPES:
        raise HTTPException(status_code=400, detail="Unknown job type")
    return data


async def geocode_address(address: str):
    """Best-effort lookup of a site's coordinates from its address (OpenStreetMap Nominatim).
    Used only when no location was given. Returns {latitude, longitude} or None."""
    import asyncio
    import json as _json
    import urllib.parse
    import urllib.request

    def lookup():
        url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
            {"q": address, "format": "json", "limit": 1})
        req = urllib.request.Request(url, headers={"User-Agent": "VanGuard-Drywall-App/2.0"})
        with urllib.request.urlopen(req, timeout=8) as r:
            hits = _json.loads(r.read().decode())
        if hits:
            return {"latitude": float(hits[0]["lat"]), "longitude": float(hits[0]["lon"])}
        return None
    try:
        return await asyncio.get_event_loop().run_in_executor(None, lookup)
    except Exception:  # noqa: BLE001
        logger.info("Could not geocode address: %s", address)
        return None


@api_router.get("/sites", response_model=List[SiteResponse])
async def get_sites(current_user: dict = Depends(get_current_user)):
    if is_office(current_user):
        sites = await db.sites.find().sort("name", 1).to_list(1000)
    else:
        ids = [ObjectId(sid) for sid in current_user.get("assigned_sites", []) if ObjectId.is_valid(sid)]
        sites = await db.sites.find({"_id": {"$in": ids}}).sort("name", 1).to_list(1000)
    return [await site_out(s_) for s_ in sites]


@api_router.post("/sites", response_model=SiteResponse)
async def create_site(site_data: SiteCreate, current_user: dict = Depends(get_current_office_user)):
    data = validate_site_fields(site_data.model_dump())
    if not data.get("location"):
        data["location"] = await geocode_address(data["address"])
    data["created_at"] = datetime.utcnow()
    result = await db.sites.insert_one(data)
    return await site_out(await db.sites.find_one({"_id": result.inserted_id}))


@api_router.put("/sites/{site_id}", response_model=SiteResponse)
async def update_site(site_id: str, site_data: SiteUpdate, current_user: dict = Depends(get_current_office_user)):
    site = await db.sites.find_one({"_id": ObjectId(site_id)})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    update = validate_site_fields({k: v for k, v in site_data.model_dump().items() if v is not None})
    if "address" in update and update["address"] != site.get("address") and "location" not in update:
        located = await geocode_address(update["address"])
        if located:
            update["location"] = located
    if update:
        await db.sites.update_one({"_id": site["_id"]}, {"$set": update})
        if "name" in update:  # keep denormalised names in step
            await db.clock_records.update_many({"site_id": site_id}, {"$set": {"site_name": update["name"]}})
    return await site_out(await db.sites.find_one({"_id": site["_id"]}))


@api_router.post("/sites/{site_id}/shutdown", response_model=SiteResponse)
async def shutdown_site(site_id: str, body: ShutdownRequest,
                        current_user: dict = Depends(require_roles(*SHUTDOWN_ROLES))):
    """Shut a job site down: nobody can clock in until it is reopened."""
    site = await db.sites.find_one({"_id": ObjectId(site_id)})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    now = datetime.utcnow()
    await db.sites.update_one({"_id": site["_id"]}, {"$set": {
        "status": "shutdown", "shutdown_reason": body.reason.strip(), "shutdown_at": now,
        "shutdown_by": str(current_user["_id"]), "shutdown_by_name": current_user["name"]}})
    if body.clock_out_everyone:
        async for rec in db.clock_records.find({"site_id": site_id, "status": "clocked_in"}):
            hours = (now - rec["clock_in"]).total_seconds() / 3600
            await db.clock_records.update_one({"_id": rec["_id"]}, {"$set": {
                "clock_out": now, "clock_out_location": rec.get("clock_in_location"),
                "total_hours": round(hours, 2), "status": "clocked_out",
                "auto_clock_out_reason": "Site shut down: " + body.reason.strip()}})
    await db.site_events.insert_one({"site_id": site_id, "event": "shutdown", "reason": body.reason.strip(),
                                     "by": str(current_user["_id"]), "by_name": current_user["name"], "at": now})
    logger.info("Site %s shut down by %s", site["name"], current_user["email"])
    return await site_out(await db.sites.find_one({"_id": site["_id"]}))


@api_router.post("/sites/{site_id}/reopen", response_model=SiteResponse)
async def reopen_site(site_id: str, current_user: dict = Depends(require_roles(*SHUTDOWN_ROLES))):
    site = await db.sites.find_one({"_id": ObjectId(site_id)})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    await db.sites.update_one({"_id": site["_id"]}, {
        "$set": {"status": "active"},
        "$unset": {"shutdown_reason": "", "shutdown_at": "", "shutdown_by": "", "shutdown_by_name": ""}})
    await db.site_events.insert_one({"site_id": site_id, "event": "reopen", "by": str(current_user["_id"]),
                                     "by_name": current_user["name"], "at": datetime.utcnow()})
    return await site_out(await db.sites.find_one({"_id": site["_id"]}))


@api_router.delete("/sites/{site_id}")
async def delete_site(site_id: str, current_user: dict = Depends(require_roles(ROLE_ADMIN, ROLE_PM))):
    result = await db.sites.delete_one({"_id": ObjectId(site_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Site not found")
    await db.users.update_many({}, {"$pull": {"assigned_sites": site_id}})
    return {"message": "Site deleted successfully"}


# ============ CLOCK IN/OUT ROUTES ============

@api_router.post("/clock/in", response_model=ClockRecordResponse)
async def clock_in(clock_data: ClockInRequest, current_user: dict = Depends(get_current_user)):
    # Check if already clocked in
    active_record = await db.clock_records.find_one({
        "user_id": str(current_user["_id"]),
        "status": "clocked_in"
    })
    
    if active_record:
        raise HTTPException(status_code=400, detail="Already clocked in. Please clock out first.")

    if not ObjectId.is_valid(clock_data.site_id):
        raise HTTPException(status_code=404, detail="Site not found")
    site = await db.sites.find_one({"_id": ObjectId(clock_data.site_id)})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    if not can_access_site(current_user, clock_data.site_id):
        raise HTTPException(status_code=403, detail="You're not assigned to this site. Ask your foreman or PM.")
    if site.get("status") == "shutdown":
        raise HTTPException(status_code=423, detail="%s is shut down: %s. Clock-in is disabled until it reopens."
                            % (site["name"], site.get("shutdown_reason") or "no reason given"))
    if site.get("status") == "completed":
        raise HTTPException(status_code=423, detail="%s is marked completed." % site["name"])

    ok, dist, problem = geofence_check(site, clock_data.location.model_dump(), clock_data.accuracy_m)
    if not ok:
        await db.clock_attempts.insert_one({
            "user_id": str(current_user["_id"]), "user_name": current_user["name"], "site_id": clock_data.site_id,
            "site_name": site["name"], "location": clock_data.location.model_dump(), "distance_m": dist,
            "accuracy_m": clock_data.accuracy_m, "at": datetime.utcnow()})
        raise HTTPException(status_code=403, detail=problem)

    record = {
        "user_id": str(current_user["_id"]),
        "user_name": current_user["name"],
        "site_id": clock_data.site_id,
        "site_name": site["name"],
        "clock_in": datetime.utcnow(),
        "clock_in_location": clock_data.location.model_dump(),
        "clock_out": None,
        "clock_out_location": None,
        "total_hours": None,
        "status": "clocked_in",
        "synced": True,
        "clock_in_distance_m": dist,
        "flagged": dist is None,
        "flag_reason": problem if dist is None else None,
    }

    result = await db.clock_records.insert_one(record)
    record["id"] = str(result.inserted_id)
    
    return ClockRecordResponse(**record)


@api_router.post("/clock/out", response_model=ClockRecordResponse)
async def clock_out(clock_data: ClockOutRequest, current_user: dict = Depends(get_current_user)):
    # Find active clock in record
    active_record = await db.clock_records.find_one({
        "user_id": str(current_user["_id"]),
        "status": "clocked_in"
    })
    
    if not active_record:
        raise HTTPException(status_code=400, detail="No active clock-in found. Please clock in first.")
    
    clock_out_time = datetime.utcnow()
    clock_in_time = active_record["clock_in"]
    out_site = await db.sites.find_one({"_id": ObjectId(active_record["site_id"])}) \
        if ObjectId.is_valid(active_record["site_id"]) else None
    out_dist = None
    if out_site and out_site.get("location"):
        out_dist = round(distance_m(out_site["location"], clock_data.location.model_dump()))
    total_hours = (clock_out_time - clock_in_time).total_seconds() / 3600
    
    await db.clock_records.update_one(
        {"_id": active_record["_id"]},
        {"$set": {
            "clock_out": clock_out_time,
            "clock_out_location": clock_data.location.model_dump(),
            "total_hours": round(total_hours, 2),
            "status": "clocked_out",
            "synced": True,
            "clock_out_distance_m": out_dist,
        }}
    )
    
    updated_record = await db.clock_records.find_one({"_id": active_record["_id"]})
    updated_record["id"] = str(updated_record.pop("_id"))
    
    return ClockRecordResponse(**updated_record)


@api_router.get("/clock/active")
async def get_active_clock(current_user: dict = Depends(get_current_user)):
    active_record = await db.clock_records.find_one({
        "user_id": str(current_user["_id"]),
        "status": "clocked_in"
    })
    
    if not active_record:
        return {"status": "not_clocked_in", "record": None}
    
    active_record["id"] = str(active_record.pop("_id"))
    return {"status": "clocked_in", "record": ClockRecordResponse(**active_record)}


@api_router.get("/clock/my-records", response_model=List[ClockRecordResponse])
async def get_my_records(current_user: dict = Depends(get_current_user)):
    records = await db.clock_records.find({
        "user_id": str(current_user["_id"])
    }).sort("clock_in", -1).to_list(1000)
    
    return [ClockRecordResponse(
        id=str(r["_id"]),
        user_id=r["user_id"],
        user_name=r["user_name"],
        site_id=r["site_id"],
        site_name=r["site_name"],
        clock_in=r["clock_in"],
        clock_in_location=LocationModel(**r["clock_in_location"]),
        clock_out=r.get("clock_out"),
        clock_out_location=LocationModel(**r["clock_out_location"]) if r.get("clock_out_location") else None,
        total_hours=r.get("total_hours"),
        status=r["status"],
        synced=r.get("synced", True)
    ) for r in records]


@api_router.get("/clock/records", response_model=List[ClockRecordResponse])
async def get_all_records(
    site_id: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_manager)
):
    query = {}
    
    if site_id:
        query["site_id"] = site_id
    
    if start_date:
        query["clock_in"] = {"$gte": datetime.fromisoformat(start_date)}
    
    if end_date:
        if "clock_in" in query:
            query["clock_in"]["$lte"] = datetime.fromisoformat(end_date)
        else:
            query["clock_in"] = {"$lte": datetime.fromisoformat(end_date)}
    
    records = await db.clock_records.find(query).sort("clock_in", -1).to_list(1000)
    
    return [ClockRecordResponse(
        id=str(r["_id"]),
        user_id=r["user_id"],
        user_name=r["user_name"],
        site_id=r["site_id"],
        site_name=r["site_name"],
        clock_in=r["clock_in"],
        clock_in_location=LocationModel(**r["clock_in_location"]),
        clock_out=r.get("clock_out"),
        clock_out_location=LocationModel(**r["clock_out_location"]) if r.get("clock_out_location") else None,
        total_hours=r.get("total_hours"),
        status=r["status"],
        synced=r.get("synced", True)
    ) for r in records]


# ============ SAFETY DOCUMENT ROUTES ============

@api_router.post("/safety/upload", response_model=SafetyDocumentResponse)
async def upload_safety_document(doc_data: SafetyDocumentCreate, current_user: dict = Depends(get_current_user)):
    # Get site info
    site = await db.sites.find_one({"_id": ObjectId(doc_data.site_id)})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    document = {
        "user_id": str(current_user["_id"]),
        "user_name": current_user["name"],
        "site_id": doc_data.site_id,
        "site_name": site["name"],
        "document_type": doc_data.document_type,
        "file_data": doc_data.file_data,
        "file_name": doc_data.file_name,
        "description": doc_data.description,
        "expiry_date": doc_data.expiry_date,
        "created_at": datetime.utcnow()
    }
    
    result = await db.safety_documents.insert_one(document)
    document["id"] = str(result.inserted_id)
    
    # Calculate expiry info
    is_expiring_soon, is_expiring_critical, days_until_expiry = calculate_expiry_info(doc_data.expiry_date)
    document["is_expiring_soon"] = is_expiring_soon
    document["is_expiring_critical"] = is_expiring_critical
    document["days_until_expiry"] = days_until_expiry
    
    return SafetyDocumentResponse(**document)


@api_router.get("/safety/my-documents", response_model=List[SafetyDocumentResponse])
async def get_my_documents(current_user: dict = Depends(get_current_user)):
    documents = await db.safety_documents.find({
        "user_id": str(current_user["_id"])
    }).sort("created_at", -1).to_list(1000)
    
    result = []
    for d in documents:
        is_expiring_soon, is_expiring_critical, days_until_expiry = calculate_expiry_info(d.get("expiry_date"))
        result.append(SafetyDocumentResponse(
            id=str(d["_id"]),
            user_id=d["user_id"],
            user_name=d["user_name"],
            site_id=d["site_id"],
            site_name=d["site_name"],
            document_type=d["document_type"],
            file_data=d["file_data"],
            file_name=d["file_name"],
            description=d.get("description"),
            expiry_date=d.get("expiry_date"),
            is_expiring_soon=is_expiring_soon,
            is_expiring_critical=is_expiring_critical,
            days_until_expiry=days_until_expiry,
            created_at=d["created_at"]
        ))
    
    return result


@api_router.get("/safety/expiring", response_model=List[SafetyDocumentResponse])
async def get_expiring_documents(current_user: dict = Depends(get_current_user)):
    """Get worker's expiring documents (for notifications)"""
    documents = await db.safety_documents.find({
        "user_id": str(current_user["_id"])
    }).to_list(1000)
    
    expiring_docs = []
    for d in documents:
        is_expiring_soon, is_expiring_critical, days_until_expiry = calculate_expiry_info(d.get("expiry_date"))
        if is_expiring_soon or is_expiring_critical:
            expiring_docs.append(SafetyDocumentResponse(
                id=str(d["_id"]),
                user_id=d["user_id"],
                user_name=d["user_name"],
                site_id=d["site_id"],
                site_name=d["site_name"],
                document_type=d["document_type"],
                file_data=d["file_data"],
                file_name=d["file_name"],
                description=d.get("description"),
                expiry_date=d.get("expiry_date"),
                is_expiring_soon=is_expiring_soon,
                is_expiring_critical=is_expiring_critical,
                days_until_expiry=days_until_expiry,
                created_at=d["created_at"]
            ))
    
    return expiring_docs


@api_router.get("/safety/documents", response_model=List[SafetyDocumentResponse])
async def get_all_documents(
    site_id: Optional[str] = Query(None),
    expiring_only: Optional[bool] = Query(False),
    current_user: dict = Depends(get_current_manager)
):
    query = {}
    
    if site_id:
        query["site_id"] = site_id
    
    documents = await db.safety_documents.find(query).sort("created_at", -1).to_list(1000)
    
    result = []
    for d in documents:
        is_expiring_soon, is_expiring_critical, days_until_expiry = calculate_expiry_info(d.get("expiry_date"))
        
        if expiring_only and not (is_expiring_soon or is_expiring_critical):
            continue
        
        result.append(SafetyDocumentResponse(
            id=str(d["_id"]),
            user_id=d["user_id"],
            user_name=d["user_name"],
            site_id=d["site_id"],
            site_name=d["site_name"],
            document_type=d["document_type"],
            file_data=d["file_data"],
            file_name=d["file_name"],
            description=d.get("description"),
            expiry_date=d.get("expiry_date"),
            is_expiring_soon=is_expiring_soon,
            is_expiring_critical=is_expiring_critical,
            days_until_expiry=days_until_expiry,
            created_at=d["created_at"]
        ))
    
    return result


# ============ ANNOUNCEMENT ROUTES ============

@api_router.get("/announcements", response_model=List[AnnouncementResponse])
async def get_announcements(
    site_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    query = {}
    
    if current_user["role"] == "worker":
        # Workers only see announcements for their assigned sites
        assigned_site_ids = current_user.get("assigned_sites", [])
        query["site_id"] = {"$in": assigned_site_ids}
    
    if site_id:
        query["site_id"] = site_id
    
    announcements = await db.announcements.find(query).sort("created_at", -1).to_list(1000)
    
    return [AnnouncementResponse(
        id=str(a["_id"]),
        site_id=a["site_id"],
        site_name=a["site_name"],
        title=a["title"],
        content=a["content"],
        announcement_type=a.get("announcement_type", "general"),
        created_by=a["created_by"],
        created_by_name=a["created_by_name"],
        created_at=a["created_at"],
        updated_at=a.get("updated_at")
    ) for a in announcements]


@api_router.post("/announcements", response_model=AnnouncementResponse)
async def create_announcement(
    announcement_data: AnnouncementCreate,
    current_user: dict = Depends(get_current_manager)
):
    # Get site info
    site = await db.sites.find_one({"_id": ObjectId(announcement_data.site_id)})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    announcement = {
        "site_id": announcement_data.site_id,
        "site_name": site["name"],
        "title": announcement_data.title,
        "content": announcement_data.content,
        "announcement_type": announcement_data.announcement_type,
        "created_by": str(current_user["_id"]),
        "created_by_name": current_user["name"],
        "created_at": datetime.utcnow(),
        "updated_at": None
    }
    
    result = await db.announcements.insert_one(announcement)
    announcement["id"] = str(result.inserted_id)
    
    return AnnouncementResponse(**announcement)


@api_router.put("/announcements/{announcement_id}", response_model=AnnouncementResponse)
async def update_announcement(
    announcement_id: str,
    announcement_data: AnnouncementUpdate,
    current_user: dict = Depends(get_current_manager)
):
    update_dict = {k: v for k, v in announcement_data.model_dump().items() if v is not None}
    update_dict["updated_at"] = datetime.utcnow()
    
    await db.announcements.update_one(
        {"_id": ObjectId(announcement_id)},
        {"$set": update_dict}
    )
    
    updated_announcement = await db.announcements.find_one({"_id": ObjectId(announcement_id)})
    if not updated_announcement:
        raise HTTPException(status_code=404, detail="Announcement not found")
    
    return AnnouncementResponse(
        id=str(updated_announcement["_id"]),
        site_id=updated_announcement["site_id"],
        site_name=updated_announcement["site_name"],
        title=updated_announcement["title"],
        content=updated_announcement["content"],
        announcement_type=updated_announcement.get("announcement_type", "general"),
        created_by=updated_announcement["created_by"],
        created_by_name=updated_announcement["created_by_name"],
        created_at=updated_announcement["created_at"],
        updated_at=updated_announcement.get("updated_at")
    )


@api_router.delete("/announcements/{announcement_id}")
async def delete_announcement(announcement_id: str, current_user: dict = Depends(get_current_manager)):
    result = await db.announcements.delete_one({"_id": ObjectId(announcement_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Announcement not found")
    return {"message": "Announcement deleted successfully"}


# ============ FILE SHARE ROUTES ============

@api_router.post("/files/upload", response_model=SharedFileResponse)
async def upload_shared_file(file_data: SharedFileCreate, current_user: dict = Depends(get_current_manager)):
    # Get site info
    site = await db.sites.find_one({"_id": ObjectId(file_data.site_id)})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    shared_file = {
        "site_id": file_data.site_id,
        "site_name": site["name"],
        "category": file_data.category,
        "file_name": file_data.file_name,
        "file_data": file_data.file_data,
        "description": file_data.description,
        "uploaded_by": str(current_user["_id"]),
        "uploaded_by_name": current_user["name"],
        "created_at": datetime.utcnow()
    }
    
    result = await db.shared_files.insert_one(shared_file)
    shared_file["id"] = str(result.inserted_id)
    
    return SharedFileResponse(**shared_file)


@api_router.get("/files", response_model=List[SharedFileResponse])
async def get_shared_files(
    site_id: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    query = {}
    
    if current_user["role"] == "worker":
        # Workers only see files for their assigned sites
        assigned_site_ids = current_user.get("assigned_sites", [])
        query["site_id"] = {"$in": assigned_site_ids}
    
    if site_id:
        query["site_id"] = site_id
    
    if category:
        query["category"] = category
    
    files = await db.shared_files.find(query).sort("created_at", -1).to_list(1000)
    
    return [SharedFileResponse(
        id=str(f["_id"]),
        site_id=f["site_id"],
        site_name=f["site_name"],
        category=f["category"],
        file_name=f["file_name"],
        file_data=f["file_data"],
        description=f.get("description"),
        uploaded_by=f["uploaded_by"],
        uploaded_by_name=f["uploaded_by_name"],
        created_at=f["created_at"]
    ) for f in files]


@api_router.delete("/files/{file_id}")
async def delete_shared_file(file_id: str, current_user: dict = Depends(get_current_manager)):
    result = await db.shared_files.delete_one({"_id": ObjectId(file_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="File not found")
    return {"message": "File deleted successfully"}


# ============ SYNC ROUTES (For Offline Mode) ============

@api_router.post("/sync", response_model=SyncDataResponse)
async def sync_data(sync_request: SyncDataRequest, current_user: dict = Depends(get_current_user)):
    """Sync offline data from device to server"""
    synced_clock = 0
    synced_safety = 0
    
    # Sync clock records
    for clock_record in sync_request.clock_records:
        try:
            # Check if record already exists
            rid = clock_record.get("id")
            existing = await db.clock_records.find_one({"_id": ObjectId(rid)}) if rid and ObjectId.is_valid(rid) \
                else await db.clock_records.find_one({"offline_id": rid}) if rid else None
            if not existing:
                record_dict = clock_record.copy()
                record_dict.pop("id", None)
                record_dict["offline_id"] = rid
                record_dict["user_id"] = str(current_user["_id"])
                record_dict["user_name"] = current_user["name"]
                record_dict["synced"] = True
                # Offline clock-ins get the same checks; problems are flagged for the office
                # rather than dropped, so nobody loses recorded hours.
                problems = []
                sid = record_dict.get("site_id")
                site = await db.sites.find_one({"_id": ObjectId(sid)}) if sid and ObjectId.is_valid(sid) else None
                if not site:
                    problems.append("unknown site")
                else:
                    record_dict["site_name"] = site["name"]
                    if not can_access_site(current_user, sid):
                        problems.append("not assigned to this site")
                    if site.get("status") == "shutdown":
                        problems.append("site was shut down")
                    loc = record_dict.get("clock_in_location")
                    if loc:
                        ok, dist, msg = geofence_check(site, loc, record_dict.get("accuracy_m"))
                        record_dict["clock_in_distance_m"] = dist
                        if not ok or dist is None:
                            problems.append(msg)
                    else:
                        problems.append("no GPS location")
                record_dict["flagged"] = bool(problems)
                record_dict["flag_reason"] = "; ".join(problems) or None
                for key in ("clock_in", "clock_out"):
                    if isinstance(record_dict.get(key), str):
                        record_dict[key] = datetime.fromisoformat(record_dict[key].replace("Z", "+00:00")).replace(tzinfo=None)
                await db.clock_records.insert_one(record_dict)
                synced_clock += 1
        except Exception as e:
            logger.error(f"Error syncing clock record: {e}")
    
    # Sync safety documents
    for safety_doc in sync_request.safety_documents:
        try:
            existing = await db.safety_documents.find_one({"_id": ObjectId(safety_doc.get("id"))})
            if not existing:
                doc_dict = safety_doc.copy()
                doc_dict.pop("id", None)
                doc_dict["user_id"] = str(current_user["_id"])
                doc_dict["user_name"] = current_user["name"]
                await db.safety_documents.insert_one(doc_dict)
                synced_safety += 1
        except Exception as e:
            logger.error(f"Error syncing safety document: {e}")
    
    # Get new data since last sync
    last_sync_date = datetime.fromisoformat(sync_request.last_sync) if sync_request.last_sync else datetime.utcnow() - timedelta(days=365)
    
    # Get new announcements
    new_announcements = await db.announcements.find({
        "site_id": {"$in": current_user.get("assigned_sites", [])},
        "created_at": {"$gte": last_sync_date}
    }).to_list(1000)
    
    # Get new shared files
    new_files = await db.shared_files.find({
        "site_id": {"$in": current_user.get("assigned_sites", [])},
        "created_at": {"$gte": last_sync_date}
    }).to_list(1000)
    
    return SyncDataResponse(
        success=True,
        synced_clock_records=synced_clock,
        synced_safety_documents=synced_safety,
        new_data={
            "announcements": [serialize_doc(a) for a in new_announcements],
            "shared_files": [serialize_doc(f) for f in new_files]
        }
    )


# ============ REPORTS ROUTES ============

@api_router.get("/reports/timesheet")
async def generate_timesheet_report(
    site_id: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_manager)
):
    """Generate Excel timesheet report"""
    query = {"status": "clocked_out"}
    
    if site_id:
        query["site_id"] = site_id
    
    if start_date:
        query["clock_in"] = {"$gte": datetime.fromisoformat(start_date)}
    
    if end_date:
        if "clock_in" in query:
            query["clock_in"]["$lte"] = datetime.fromisoformat(end_date)
        else:
            query["clock_in"] = {"$lte": datetime.fromisoformat(end_date)}
    
    records = await db.clock_records.find(query).sort("clock_in", -1).to_list(10000)
    
    # Create Excel workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "Timesheet Report"
    
    # Headers
    headers = ["Worker Name", "Site Name", "Clock In", "Clock Out", "Total Hours", "Clock In Location", "Clock Out Location"]
    ws.append(headers)
    
    # Style headers - VanGuard navy
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="0B2556", end_color="0B2556", fill_type="solid")
    for cell in ws[1]:
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
    
    # Add data
    for record in records:
        clock_in_loc = f"{record['clock_in_location']['latitude']}, {record['clock_in_location']['longitude']}"
        clock_out_loc = ""
        if record.get('clock_out_location'):
            clock_out_loc = f"{record['clock_out_location']['latitude']}, {record['clock_out_location']['longitude']}"
        
        ws.append([
            record["user_name"],
            record["site_name"],
            record["clock_in"].strftime("%Y-%m-%d %H:%M:%S"),
            record["clock_out"].strftime("%Y-%m-%d %H:%M:%S") if record.get("clock_out") else "",
            record.get("total_hours", 0),
            clock_in_loc,
            clock_out_loc
        ])
    
    # Auto-adjust column widths
    for column in ws.columns:
        max_length = 0
        column_letter = column[0].column_letter
        for cell in column:
            try:
                if len(str(cell.value)) > max_length:
                    max_length = len(cell.value)
            except:
                pass
        adjusted_width = min(max_length + 2, 50)
        ws.column_dimensions[column_letter].width = adjusted_width
    
    # Save to bytes
    excel_file = io.BytesIO()
    wb.save(excel_file)
    excel_file.seek(0)
    
    filename = f"vanguard_timesheet_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    
    return StreamingResponse(
        excel_file,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@api_router.get("/reports/dashboard")
async def get_dashboard_stats(current_user: dict = Depends(get_current_manager)):
    """Get dashboard statistics for managers"""
    total_workers = await db.users.count_documents({"role": {"$in": sorted(FIELD_ROLES)}})
    total_managers = max(0, await db.users.count_documents({"role": {"$in": sorted(OFFICE_ROLES)}}) - 1)
    total_sites = await db.sites.count_documents({"status": {"$ne": "completed"}})
    shutdown_sites = await db.sites.count_documents({"status": "shutdown"})
    flagged_open = await db.clock_records.count_documents({"flagged": True, "flag_reviewed": {"$ne": True}})
    
    # Currently clocked in workers
    clocked_in_count = await db.clock_records.count_documents({"status": "clocked_in"})
    
    # Expiring safety documents (60 days or less)
    all_safety_docs = await db.safety_documents.find().to_list(10000)
    expiring_count = 0
    critical_expiring_count = 0
    
    for doc in all_safety_docs:
        is_expiring_soon, is_expiring_critical, _ = calculate_expiry_info(doc.get("expiry_date"))
        if is_expiring_critical:
            critical_expiring_count += 1
        elif is_expiring_soon:
            expiring_count += 1
    
    # Today's records
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_records = await db.clock_records.count_documents({
        "clock_in": {"$gte": today_start}
    })
    
    return {
        "total_workers": total_workers,
        "total_managers": total_managers,
        "total_sites": total_sites,
        "clocked_in_workers": clocked_in_count,
        "expiring_safety_documents": expiring_count,
        "critical_expiring_safety_documents": critical_expiring_count,
        "today_clock_records": today_records,
        "shutdown_sites": shutdown_sites,
        "flagged_clock_records": flagged_open,
    }


# ============ TASK ROUTES ============

@api_router.post("/tasks", response_model=TaskResponse)
async def create_task(task_data: TaskCreate, current_user: dict = Depends(get_current_manager)):
    # Get site and user info
    site = await db.sites.find_one({"_id": ObjectId(task_data.site_id)})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    assigned_user = await db.users.find_one({"_id": ObjectId(task_data.assigned_to)})
    if not assigned_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    task = {
        "title": task_data.title,
        "description": task_data.description,
        "site_id": task_data.site_id,
        "site_name": site["name"],
        "assigned_to": task_data.assigned_to,
        "assigned_to_name": assigned_user["name"],
        "priority": task_data.priority,
        "task_type": task_data.task_type,
        "status": "todo",
        "due_date": task_data.due_date,
        "created_by": str(current_user["_id"]),
        "created_by_name": current_user["name"],
        "created_at": datetime.utcnow(),
        "updated_at": None
    }
    
    result = await db.tasks.insert_one(task)
    task["id"] = str(result.inserted_id)
    
    return TaskResponse(**task)


@api_router.get("/tasks/my-tasks", response_model=List[TaskResponse])
async def get_my_tasks(current_user: dict = Depends(get_current_user)):
    tasks = await db.tasks.find({
        "assigned_to": str(current_user["_id"])
    }).sort("created_at", -1).to_list(1000)
    
    return [TaskResponse(
        id=str(t["_id"]),
        title=t["title"],
        description=t.get("description"),
        site_id=t["site_id"],
        site_name=t["site_name"],
        assigned_to=t["assigned_to"],
        assigned_to_name=t["assigned_to_name"],
        priority=t["priority"],
        task_type=t["task_type"],
        status=t["status"],
        due_date=t.get("due_date"),
        created_by=t["created_by"],
        created_by_name=t["created_by_name"],
        created_at=t["created_at"],
        updated_at=t.get("updated_at")
    ) for t in tasks]


@api_router.get("/tasks", response_model=List[TaskResponse])
async def get_all_tasks(
    site_id: Optional[str] = Query(None),
    assigned_to: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_manager)
):
    query = {}
    if site_id:
        query["site_id"] = site_id
    if assigned_to:
        query["assigned_to"] = assigned_to
    
    tasks = await db.tasks.find(query).sort("created_at", -1).to_list(1000)
    
    return [TaskResponse(
        id=str(t["_id"]),
        title=t["title"],
        description=t.get("description"),
        site_id=t["site_id"],
        site_name=t["site_name"],
        assigned_to=t["assigned_to"],
        assigned_to_name=t["assigned_to_name"],
        priority=t["priority"],
        task_type=t["task_type"],
        status=t["status"],
        due_date=t.get("due_date"),
        created_by=t["created_by"],
        created_by_name=t["created_by_name"],
        created_at=t["created_at"],
        updated_at=t.get("updated_at")
    ) for t in tasks]


@api_router.put("/tasks/{task_id}", response_model=TaskResponse)
async def update_task(task_id: str, task_data: TaskUpdate, current_user: dict = Depends(get_current_user)):
    update_dict = {k: v for k, v in task_data.model_dump().items() if v is not None}
    update_dict["updated_at"] = datetime.utcnow()
    
    await db.tasks.update_one(
        {"_id": ObjectId(task_id)},
        {"$set": update_dict}
    )
    
    updated_task = await db.tasks.find_one({"_id": ObjectId(task_id)})
    if not updated_task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    return TaskResponse(
        id=str(updated_task["_id"]),
        title=updated_task["title"],
        description=updated_task.get("description"),
        site_id=updated_task["site_id"],
        site_name=updated_task["site_name"],
        assigned_to=updated_task["assigned_to"],
        assigned_to_name=updated_task["assigned_to_name"],
        priority=updated_task["priority"],
        task_type=updated_task["task_type"],
        status=updated_task["status"],
        due_date=updated_task.get("due_date"),
        created_by=updated_task["created_by"],
        created_by_name=updated_task["created_by_name"],
        created_at=updated_task["created_at"],
        updated_at=updated_task.get("updated_at")
    )


@api_router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, current_user: dict = Depends(get_current_manager)):
    result = await db.tasks.delete_one({"_id": ObjectId(task_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": "Task deleted successfully"}


# ============ CUSTOM FORM ROUTES ============

@api_router.post("/forms/templates", response_model=FormTemplateResponse)
async def create_form_template(form_data: FormTemplateCreate, current_user: dict = Depends(get_current_manager)):
    site_name = None
    if form_data.site_id:
        site = await db.sites.find_one({"_id": ObjectId(form_data.site_id)})
        if site:
            site_name = site["name"]
    
    template = {
        "title": form_data.title,
        "description": form_data.description,
        "fields": [f.model_dump() for f in form_data.fields],
        "site_id": form_data.site_id,
        "site_name": site_name,
        "created_by": str(current_user["_id"]),
        "created_by_name": current_user["name"],
        "created_at": datetime.utcnow()
    }
    
    result = await db.form_templates.insert_one(template)
    template["id"] = str(result.inserted_id)
    
    return FormTemplateResponse(**template)


@api_router.get("/forms/templates", response_model=List[FormTemplateResponse])
async def get_form_templates(
    site_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if is_office(current_user):
        if site_id:
            query["site_id"] = site_id
    else:
        # Workers only see forms for their sites
        assigned_sites = current_user.get("assigned_sites", [])
        query["$or"] = [
            {"site_id": {"$in": assigned_sites}},
            {"site_id": None}  # General forms
        ]
    
    templates = await db.form_templates.find(query).sort("created_at", -1).to_list(1000)
    
    return [FormTemplateResponse(
        id=str(t["_id"]),
        title=t["title"],
        description=t.get("description"),
        fields=[FormField(**f) for f in t["fields"]],
        site_id=t.get("site_id"),
        site_name=t.get("site_name"),
        created_by=t["created_by"],
        created_by_name=t["created_by_name"],
        created_at=t["created_at"]
    ) for t in templates]


@api_router.post("/forms/assign")
async def assign_form(assignment: FormAssignment, current_user: dict = Depends(get_current_manager)):
    # Create assignment records
    for user_id in assignment.assigned_to:
        assignment_record = {
            "form_id": assignment.form_id,
            "user_id": user_id,
            "due_date": assignment.due_date,
            "status": "pending",
            "assigned_at": datetime.utcnow()
        }
        await db.form_assignments.insert_one(assignment_record)
    
    return {"message": f"Form assigned to {len(assignment.assigned_to)} user(s)"}


@api_router.get("/forms/my-assignments")
async def get_my_form_assignments(current_user: dict = Depends(get_current_user)):
    assignments = await db.form_assignments.find({
        "user_id": str(current_user["_id"]),
        "status": "pending"
    }).to_list(1000)
    
    # Get form details for each assignment
    result = []
    for assignment in assignments:
        form = await db.form_templates.find_one({"_id": ObjectId(assignment["form_id"])})
        if form:
            result.append({
                "assignment_id": str(assignment["_id"]),
                "form_id": str(form["_id"]),
                "form_title": form["title"],
                "form_description": form.get("description"),
                "due_date": assignment.get("due_date"),
                "assigned_at": assignment["assigned_at"]
            })
    
    return result


@api_router.post("/forms/submit", response_model=FormSubmissionResponse)
async def submit_form(submission: FormResponse, current_user: dict = Depends(get_current_user)):
    # Get form template
    form = await db.form_templates.find_one({"_id": ObjectId(submission.form_id)})
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    
    submission_record = {
        "form_id": submission.form_id,
        "form_title": form["title"],
        "user_id": str(current_user["_id"]),
        "user_name": current_user["name"],
        "responses": submission.responses,
        "submitted_at": datetime.utcnow()
    }
    
    result = await db.form_submissions.insert_one(submission_record)
    
    # Mark assignment as complete
    await db.form_assignments.update_one(
        {"form_id": submission.form_id, "user_id": str(current_user["_id"])},
        {"$set": {"status": "completed", "completed_at": datetime.utcnow()}}
    )
    
    submission_record["id"] = str(result.inserted_id)
    
    return FormSubmissionResponse(**submission_record)


@api_router.get("/forms/submissions", response_model=List[FormSubmissionResponse])
async def get_form_submissions(
    form_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_manager)
):
    query = {}
    if form_id:
        query["form_id"] = form_id
    
    submissions = await db.form_submissions.find(query).sort("submitted_at", -1).to_list(1000)
    
    return [FormSubmissionResponse(
        id=str(s["_id"]),
        form_id=s["form_id"],
        form_title=s["form_title"],
        user_id=s["user_id"],
        user_name=s["user_name"],
        responses=s["responses"],
        submitted_at=s["submitted_at"]
    ) for s in submissions]


@api_router.delete("/forms/templates/{template_id}")
async def delete_form_template(template_id: str, current_user: dict = Depends(get_current_manager)):
    result = await db.form_templates.delete_one({"_id": ObjectId(template_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Form template not found")
    return {"message": "Form template deleted successfully"}


# Create the first admin account, only if the database has no manager yet.
# Credentials come from ADMIN_EMAIL / ADMIN_PASSWORD in backend/.env (run.py generates
# a random password). Nothing is hardcoded, and the password is never logged.
@app.on_event("startup")
async def startup_event():
    # Map Oakdale-era roles onto the new ones (runs once; harmless afterwards).
    for old, (new, level) in LEGACY_ROLES.items():
        update = {"role": new}
        if level:
            update["level"] = level
        res = await db.users.update_many({"role": old}, {"$set": update})
        if res.modified_count:
            logger.info("Migrated %d user(s) from role %s to %s", res.modified_count, old, new)
    await db.users.create_index("email", unique=True)
    await db.clock_records.create_index([("user_id", 1), ("status", 1)])
    await db.clock_records.create_index([("site_id", 1), ("status", 1)])

    if await db.users.find_one({"role": ROLE_ADMIN}):
        return
    admin_email = os.environ.get("ADMIN_EMAIL")
    admin_password = os.environ.get("ADMIN_PASSWORD")
    if not admin_email or not admin_password:
        logger.warning(
            "No manager account exists and ADMIN_EMAIL/ADMIN_PASSWORD are not set; "
            "no one can log in until they are."
        )
        return
    await db.users.insert_one({
        "email": admin_email.lower(),
        "password": get_password_hash(admin_password),
        "name": os.environ.get("ADMIN_NAME", "Administrator"),
        "role": ROLE_ADMIN,
        "assigned_sites": [],
        "created_at": datetime.utcnow(),
    })
    logger.info("Created first manager account for %s", admin_email)


# Include router
app.include_router(api_router)


# Serve the built web app (frontend/dist, made by `expo export --platform web`) on the
# same port as the API, so the office can use the app in a browser. API routes and
# /docs are registered first, so they always win over this catch-all.
FRONTEND_DIST = Path(os.environ.get("FRONTEND_DIST", ROOT_DIR.parent / "frontend" / "dist")).resolve()
if (FRONTEND_DIST / "index.html").is_file():
    from fastapi.responses import FileResponse

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_web_app(full_path: str):
        if full_path.startswith("api/") or full_path == "api":
            raise HTTPException(status_code=404, detail="Not found")
        if full_path:
            candidate = (FRONTEND_DIST / full_path).resolve()
            if FRONTEND_DIST in candidate.parents and candidate.is_file():
                return FileResponse(candidate)
        # Single-page app: every other path loads index.html and the router takes over.
        return FileResponse(FRONTEND_DIST / "index.html")

    logger.info("Serving web app from %s", FRONTEND_DIST)

# CORS: the mobile app sends a bearer token, not cookies, so credentials are off.
# Set CORS_ORIGINS in backend/.env to a comma-separated list to restrict web origins.
_cors_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
