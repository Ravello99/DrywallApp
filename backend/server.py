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
app = FastAPI(title="Oakdale Construction Management API")
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


class UserRole(str):
    APPRENTICE = "apprentice"
    JOURNEYMAN = "journeyman"
    LEAD_HAND = "lead_hand"
    FOREMAN = "foreman"
    MANAGER = "manager"


class UserBase(BaseModel):
    email: EmailStr
    name: str
    role: str = Field(default="apprentice")


class UserCreate(UserBase):
    password: str
    assigned_sites: List[str] = Field(default_factory=list)


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    assigned_sites: Optional[List[str]] = None
    password: Optional[str] = None
    role: Optional[str] = None


class UserResponse(UserBase):
    id: str
    assigned_sites: List[str] = Field(default_factory=list)
    created_at: datetime

    class Config:
        populate_by_name = True


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse


class SiteCreate(BaseModel):
    name: str
    address: str
    location: Optional[LocationModel] = None
    status: str = Field(default="active")


class SiteResponse(SiteCreate):
    id: str
    created_at: datetime


class ClockInRequest(BaseModel):
    site_id: str
    location: LocationModel


class ClockOutRequest(BaseModel):
    location: LocationModel


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


async def get_current_manager(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "manager":
        raise HTTPException(status_code=403, detail="Not authorized. Manager access required.")
    return current_user


def calculate_expiry_info(expiry_date_str: Optional[str]) -> tuple:
    """Calculate if document is expiring soon and days until expiry"""
    if not expiry_date_str:
        return False, False, None
    
    try:
        expiry_date = datetime.fromisoformat(expiry_date_str.replace('Z', '+00:00'))
        today = datetime.now(expiry_date.tzinfo) if expiry_date.tzinfo else datetime.now()
        days_until_expiry = (expiry_date - today).days
        
        is_expiring_critical = days_until_expiry <= 30 and days_until_expiry >= 0
        is_expiring_soon = days_until_expiry <= 60 and days_until_expiry > 30
        
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
    user = await db.users.find_one({"email": login_data.email})
    if not user or not verify_password(login_data.password, user["password"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    
    access_token = create_access_token(data={"sub": str(user["_id"])})
    
    user_response = UserResponse(
        id=str(user["_id"]),
        email=user["email"],
        name=user["name"],
        role=user["role"],
        assigned_sites=user.get("assigned_sites", []),
        created_at=user["created_at"]
    )
    
    return Token(
        access_token=access_token,
        token_type="bearer",
        user=user_response
    )


@api_router.get("/auth/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    return UserResponse(
        id=str(current_user["_id"]),
        email=current_user["email"],
        name=current_user["name"],
        role=current_user["role"],
        assigned_sites=current_user.get("assigned_sites", []),
        created_at=current_user["created_at"]
    )


# ============ USER MANAGEMENT ROUTES (Manager Only) ============

@api_router.get("/users", response_model=List[UserResponse])
async def get_users(current_user: dict = Depends(get_current_manager)):
    """Get all users (workers and managers)"""
    users = await db.users.find().to_list(1000)
    return [UserResponse(
        id=str(u["_id"]),
        email=u["email"],
        name=u["name"],
        role=u["role"],
        assigned_sites=u.get("assigned_sites", []),
        created_at=u["created_at"]
    ) for u in users if str(u["_id"]) != str(current_user["_id"])]  # Exclude current user


@api_router.post("/users", response_model=UserResponse)
async def create_user(user_data: UserCreate, current_user: dict = Depends(get_current_manager)):
    # Check if user already exists
    existing_user = await db.users.find_one({"email": user_data.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="User with this email already exists")
    
    user_dict = user_data.model_dump()
    user_dict["password"] = get_password_hash(user_data.password)
    user_dict["created_at"] = datetime.utcnow()
    
    result = await db.users.insert_one(user_dict)
    
    created_user = await db.users.find_one({"_id": result.inserted_id})
    return UserResponse(
        id=str(created_user["_id"]),
        email=created_user["email"],
        name=created_user["name"],
        role=created_user["role"],
        assigned_sites=created_user.get("assigned_sites", []),
        created_at=created_user["created_at"]
    )


@api_router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(user_id: str, user_data: UserUpdate, current_user: dict = Depends(get_current_manager)):
    update_dict = {k: v for k, v in user_data.model_dump().items() if v is not None}
    
    if "password" in update_dict:
        update_dict["password"] = get_password_hash(update_dict["password"])
    
    if update_dict:
        await db.users.update_one(
            {"_id": ObjectId(user_id)},
            {"$set": update_dict}
        )
    
    updated_user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not updated_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return UserResponse(
        id=str(updated_user["_id"]),
        email=updated_user["email"],
        name=updated_user["name"],
        role=updated_user["role"],
        assigned_sites=updated_user.get("assigned_sites", []),
        created_at=updated_user["created_at"]
    )


@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, current_user: dict = Depends(get_current_manager)):
    result = await db.users.delete_one({"_id": ObjectId(user_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User deleted successfully"}


# ============ SITE ROUTES ============

@api_router.get("/sites", response_model=List[SiteResponse])
async def get_sites(current_user: dict = Depends(get_current_user)):
    if current_user["role"] == "manager":
        sites = await db.sites.find().to_list(1000)
    else:
        # Workers only see their assigned sites
        assigned_site_ids = current_user.get("assigned_sites", [])
        sites = await db.sites.find({"_id": {"$in": [ObjectId(sid) for sid in assigned_site_ids]}}).to_list(1000)
    
    return [SiteResponse(
        id=str(s["_id"]),
        name=s["name"],
        address=s["address"],
        location=s.get("location"),
        status=s.get("status", "active"),
        created_at=s["created_at"]
    ) for s in sites]


@api_router.post("/sites", response_model=SiteResponse)
async def create_site(site_data: SiteCreate, current_user: dict = Depends(get_current_manager)):
    site_dict = site_data.model_dump()
    site_dict["created_at"] = datetime.utcnow()
    
    result = await db.sites.insert_one(site_dict)
    created_site = await db.sites.find_one({"_id": result.inserted_id})
    
    return SiteResponse(
        id=str(created_site["_id"]),
        name=created_site["name"],
        address=created_site["address"],
        location=created_site.get("location"),
        status=created_site.get("status", "active"),
        created_at=created_site["created_at"]
    )


@api_router.put("/sites/{site_id}", response_model=SiteResponse)
async def update_site(site_id: str, site_data: SiteCreate, current_user: dict = Depends(get_current_manager)):
    update_dict = site_data.model_dump()
    
    await db.sites.update_one(
        {"_id": ObjectId(site_id)},
        {"$set": update_dict}
    )
    
    updated_site = await db.sites.find_one({"_id": ObjectId(site_id)})
    if not updated_site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    return SiteResponse(
        id=str(updated_site["_id"]),
        name=updated_site["name"],
        address=updated_site["address"],
        location=updated_site.get("location"),
        status=updated_site.get("status", "active"),
        created_at=updated_site["created_at"]
    )


@api_router.delete("/sites/{site_id}")
async def delete_site(site_id: str, current_user: dict = Depends(get_current_manager)):
    result = await db.sites.delete_one({"_id": ObjectId(site_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Site not found")
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
    
    # Get site info
    site = await db.sites.find_one({"_id": ObjectId(clock_data.site_id)})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
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
        "synced": True
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
    total_hours = (clock_out_time - clock_in_time).total_seconds() / 3600
    
    await db.clock_records.update_one(
        {"_id": active_record["_id"]},
        {"$set": {
            "clock_out": clock_out_time,
            "clock_out_location": clock_data.location.model_dump(),
            "total_hours": round(total_hours, 2),
            "status": "clocked_out",
            "synced": True
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
            existing = await db.clock_records.find_one({"_id": ObjectId(clock_record.get("id"))})
            if not existing:
                record_dict = clock_record.copy()
                record_dict.pop("id", None)
                record_dict["user_id"] = str(current_user["_id"])
                record_dict["user_name"] = current_user["name"]
                record_dict["synced"] = True
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
    
    # Style headers - Oakdale Red
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="C8102E", end_color="C8102E", fill_type="solid")
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
    
    filename = f"oakdale_timesheet_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    
    return StreamingResponse(
        excel_file,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@api_router.get("/reports/dashboard")
async def get_dashboard_stats(current_user: dict = Depends(get_current_manager)):
    """Get dashboard statistics for managers"""
    total_workers = await db.users.count_documents({"role": {"$ne": "manager"}})
    total_managers = await db.users.count_documents({"role": "manager"}) - 1  # Exclude current user
    total_sites = await db.sites.count_documents({})
    
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
        "today_clock_records": today_records
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
    if current_user["role"] == "manager":
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
    if await db.users.find_one({"role": "manager"}):
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
        "role": "manager",
        "assigned_sites": [],
        "created_at": datetime.utcnow(),
    })
    logger.info("Created first manager account for %s", admin_email)


# Include router
app.include_router(api_router)

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
