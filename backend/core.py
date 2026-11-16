"""Shared pieces of the VanGuard API: settings, database, roles, models, auth and helpers.
Feature modules (features/*.py) and server.py import from here."""
from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, File, UploadFile, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from jose import JWTError, jwt
from pydantic import BaseModel, Field, AfterValidator
from typing_extensions import Annotated
import re
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

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("vanguard")


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


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _normalize_email(v: str) -> str:
    # A simple format check. (Pydantic's EmailStr rejects reserved domains such as
    # .local, which made the generated admin@drywall.local login impossible.)
    v = (v or "").strip().lower()
    if not _EMAIL_RE.match(v):
        raise ValueError("Enter a valid email address")
    return v


Email = Annotated[str, AfterValidator(_normalize_email)]


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
ACCOUNTING_ROLES = {ROLE_ADMIN, ROLE_COORDINATOR}             # accounting section: payroll, A/R, exports

# Roles from the Oakdale app, mapped on startup. Old crew levels become the "level" field.
LEGACY_ROLES = {"manager": (ROLE_ADMIN, None), "apprentice": (ROLE_EMPLOYEE, "apprentice"),
                "journeyman": (ROLE_EMPLOYEE, "journeyman"), "lead_hand": (ROLE_EMPLOYEE, "lead_hand")}

SPECIALTIES = ["steel_framer", "drywaller", "taper_finisher", "insulator", "acoustic_ceilings",
               "labourer", "general"]
LEVELS = ["apprentice", "journeyman", "lead_hand"]


class UserBase(BaseModel):
    email: Email
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
    email: Optional[Email] = None
    assigned_sites: Optional[List[str]] = None
    password: Optional[str] = None
    role: Optional[str] = None


class UserResponse(UserBase, UserProfileFields):
    id: str
    assigned_sites: List[str] = Field(default_factory=list)
    created_at: datetime
    must_change_password: bool = False

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
        must_change_password=bool(u.get("must_change_password")),
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
    email: str          # not format-checked: a wrong email just fails the lookup
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
    material_budget: Optional[float] = None
    labour_budget: Optional[float] = None
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
    material_budget: Optional[float] = None
    labour_budget: Optional[float] = None
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
    task_id: Optional[str] = None        # what they're working on (for hour budgets)


class ClockOutRequest(BaseModel):
    # Optional so nobody is ever stuck clocked in because their phone can't get a GPS fix;
    # clock-outs without a location are flagged for the office to review.
    location: Optional[LocationModel] = None
    accuracy_m: Optional[float] = None


class ClockRecordResponse(BaseModel):
    id: str
    user_id: str
    user_name: str
    site_id: str
    site_name: str
    clock_in: datetime
    clock_in_location: Optional[LocationModel] = None
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
    task_id: Optional[str] = None
    task_title: Optional[str] = None
    edited: bool = False
    edited_by_name: Optional[str] = None


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


def make_link_token(purpose: str, claims: dict, minutes: int = 30) -> str:
    """Short-lived signed token for a link that opens without signing in (printable invoice,
    file downloads). Tied to one purpose so it can't be used as a login."""
    return jwt.encode({**claims, "purpose": purpose, "exp": datetime.utcnow() + timedelta(minutes=minutes)},
                      SECRET_KEY, algorithm=ALGORITHM)


def read_link_token(token: str, purpose: str) -> dict:
    try:
        claims = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="This link has expired. Open it again from the app.")
    if claims.get("purpose") != purpose:
        raise HTTPException(status_code=401, detail="This link isn't valid.")
    return claims


def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def token_for(user: dict) -> str:
    """Login token. Carries the password version, so changing or resetting a password signs
    out every other device that still has an old token."""
    return create_access_token(data={"sub": str(user["_id"]), "pwv": int(user.get("pw_version") or 0)})


def password_problem(password: str, user: Optional[dict] = None) -> Optional[str]:
    if len(password or "") < 8:
        return "Use at least 8 characters"
    if password.isdigit() or password.isalpha():
        return "Use a mix of letters and numbers"
    if user and password.strip().lower() in (str(user.get("email", "")).lower(), str(user.get("name", "")).lower()):
        return "Don't use your name or email as your password"
    return None


PASSWORD_CHANGE_REQUIRED = "Please set a new password before continuing."


async def get_signed_in_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """The signed-in user, even if they still have to set a new password (only for /auth/me and
    changing the password). Everything else uses get_current_user."""
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
    if int(payload.get("pwv") or 0) != int(user.get("pw_version") or 0):
        raise HTTPException(status_code=401, detail="Your password was changed. Please sign in again.")
    if user.get("active") is False:
        raise HTTPException(status_code=401, detail="This account has been deactivated")
    return user


async def get_current_user(user: dict = Depends(get_signed_in_user)):
    if user.get("must_change_password"):
        raise HTTPException(status_code=403, detail=PASSWORD_CHANGE_REQUIRED)
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



# ============ SHARED HELPERS FOR FEATURE MODULES ============

def oid(value: str, what: str = "Item") -> ObjectId:
    """ObjectId from a path/body id, or a 404 if it isn't one."""
    if not value or not ObjectId.is_valid(value):
        raise HTTPException(status_code=404, detail="%s not found" % what)
    return ObjectId(value)


async def get_site_or_404(site_id: str) -> dict:
    site = await db.sites.find_one({"_id": oid(site_id, "Site")})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    return site


def ensure_site_access(user: dict, site_id: str) -> None:
    if not can_access_site(user, site_id):
        raise HTTPException(status_code=403, detail="You're not assigned to this site.")


def is_foreman(user: dict) -> bool:
    return user.get("role") == ROLE_FOREMAN


def visible_site_ids(user: dict) -> Optional[List[str]]:
    """None = every site (office); otherwise the user's assigned sites."""
    return None if is_office(user) else list(user.get("assigned_sites") or [])


def site_filter(user: dict, site_id: Optional[str] = None) -> dict:
    """Mongo filter on site_id limited to what this user may see."""
    allowed = visible_site_ids(user)
    if site_id:
        if allowed is not None and site_id not in allowed:
            raise HTTPException(status_code=403, detail="You're not assigned to this site.")
        return {"site_id": site_id}
    return {} if allowed is None else {"site_id": {"$in": allowed}}


def out(doc: dict, money_fields: tuple = ()) -> dict:
    """Mongo document -> JSON-friendly dict: _id -> id, cents -> dollars for money fields."""
    from logic import to_dollars
    if doc is None:
        return None
    d = dict(doc)
    d["id"] = str(d.pop("_id"))
    for f in money_fields:
        if f in d and d[f] is not None:
            d[f] = to_dollars(d[f])
    return d


async def next_number(collection: str, site_id: str) -> int:
    """Next sequence number per site (RFI #, CO #, draw #)."""
    last = await db[collection].find({"site_id": site_id}).sort("number", -1).limit(1).to_list(1)
    return (last[0]["number"] + 1) if last else 1


async def users_with_roles(roles) -> List[dict]:
    return await db.users.find({"role": {"$in": list(roles)}, "active": {"$ne": False}}).to_list(5000)


async def foremen_for_site(site_id: str) -> List[dict]:
    return await db.users.find({"role": ROLE_FOREMAN, "assigned_sites": site_id,
                                "active": {"$ne": False}}).to_list(100)


async def notify(user_ids, title: str, body: str = "", kind: str = "info", link: Optional[str] = None,
                 dedupe_key: Optional[str] = None) -> int:
    """Create in-app notifications. With dedupe_key, a user gets that notification only once."""
    count = 0
    now_ = datetime.utcnow()
    for uid in {str(u) for u in user_ids if u}:
        if dedupe_key and await db.notifications.find_one({"user_id": uid, "dedupe_key": dedupe_key}):
            continue
        await db.notifications.insert_one({"user_id": uid, "title": title, "body": body, "kind": kind,
                                           "link": link, "dedupe_key": dedupe_key, "read": False,
                                           "created_at": now_})
        count += 1
    return count
