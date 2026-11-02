from fastapi import APIRouter, Depends, HTTPException, status, Query, Header, UploadFile, File
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from pydantic import BaseModel
from typing import Optional
import hashlib
import hmac
from datetime import datetime, timedelta
import secrets
import os
import bcrypt
from fastapi import Request
from app.services.email_service import email_service
from app.log_database import LogSessionLocal as _LogSessionLocal
from app.services.log_service import log_audit as _log_audit
from app.auth_tokens import issue_token, user_from_token, bearer_value
from app.dependencies import get_current_user
from app.services import rate_limit

AVATAR_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'avatar_storage')
os.makedirs(AVATAR_DIR, exist_ok=True)

ALLOWED_IMAGE_TYPES = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}

router = APIRouter(prefix="/auth", tags=["auth"])

class UserRegister(BaseModel):
    username: str
    email: str
    password: str
    full_name: str

class UserLogin(BaseModel):
    email: str
    password: str

# Passwords are bcrypt hashes. Accounts made before that hold an unsalted
# sha256 hex digest; it is still accepted, and replaced by a bcrypt hash the
# next time the person signs in with it (login()). Replacing it changes
# password_hash, so it ends that user's earlier tokens once -- harmless there,
# since verify-otp issues the new token from the new hash straight after.
BCRYPT_ROUNDS = 12
# bcrypt reads at most 72 bytes; bcrypt 5 refuses longer input instead of
# quietly cutting it, so cut it here (the same as every bcrypt before 5).
_BCRYPT_MAX_BYTES = 72
# Checked against when the email matches nobody, so a wrong email takes as
# long to refuse as a wrong password and answers do not reveal who has an account.
_DUMMY_HASH = bcrypt.hashpw(b"not-a-password", bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode()


def _pw_bytes(password: str) -> bytes:
    return (password or "").encode("utf-8")[:_BCRYPT_MAX_BYTES]


def _is_bcrypt(hashed: Optional[str]) -> bool:
    return bool(hashed) and hashed.startswith(("$2a$", "$2b$", "$2y$"))


def hash_password(password: str) -> str:
    """A salted bcrypt hash of the password."""
    return bcrypt.hashpw(_pw_bytes(password), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode()


def get_password_hash(password: str) -> str:
    """Alias for hash_password()."""
    return hash_password(password)


def verify_password(plain_password: str, hashed_password: Optional[str]) -> bool:
    """Does the password match the stored hash (bcrypt, or an older sha256 digest)?"""
    if not hashed_password:
        return False
    if _is_bcrypt(hashed_password):
        try:
            return bcrypt.checkpw(_pw_bytes(plain_password), hashed_password.encode())
        except ValueError:          # a malformed stored hash
            return False
    legacy = hashlib.sha256((plain_password or "").encode()).hexdigest()
    return hmac.compare_digest(legacy, hashed_password)


def password_needs_upgrade(hashed_password: Optional[str]) -> bool:
    """True for an older sha256 hash that should be replaced by bcrypt."""
    return bool(hashed_password) and not _is_bcrypt(hashed_password)


def generate_otp() -> str:
    """A 6-digit code from the system's secure random source."""
    return f"{secrets.randbelow(900000) + 100000}"


# A code is voided after this many wrong tries; a new one must be asked for.
OTP_MAX_WRONG = 5
# And one address may make this many wrong tries, across every email, per window.
OTP_MAX_WRONG_PER_IP = 20
OTP_IP_WINDOW_MINUTES = 15
_OTP_IP_KIND = "agent_otp_ip"


def _set_new_otp(user: User, context: str) -> str:
    """A fresh code for the user, with the wrong-try count back at nought."""
    code = generate_otp()
    user.otp_code = code
    user.otp_expires = datetime.utcnow() + timedelta(minutes=10)
    user.otp_context = context
    user.otp_attempts = 0
    return code


@router.post("/register")
def register(user_data: UserRegister, db: Session = Depends(get_db)):
    """Register a new user - sends OTP for email verification"""

    # Check if user already exists (and is verified)
    existing_user = db.query(User).filter(
        (User.email == user_data.email) | (User.username == user_data.username)
    ).first()

    if existing_user and existing_user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email or username already registered"
        )

    if existing_user and not existing_user.is_verified:
        # Resend OTP for unverified user
        otp_code = _set_new_otp(existing_user, "register")
        db.commit()
        db_user = existing_user
    else:
        db_user = User(
            username=user_data.username,
            email=user_data.email,
            password_hash=hash_password(user_data.password),
            full_name=user_data.full_name,
            role="user",
            is_active=True,
            is_verified=False,
        )
        otp_code = _set_new_otp(db_user, "register")
        db.add(db_user)
        db.commit()
        db.refresh(db_user)

    email_service.send_otp_email(
        to_email=db_user.email,
        full_name=db_user.full_name,
        otp_code=otp_code,
        context="register",
        db=db,
    )

    return {
        "status": "otp_sent",
        "message": "Verification code sent to your email",
        "email": db_user.email,
    }

@router.post("/login")
def login(credentials: UserLogin, db: Session = Depends(get_db)):
    """Login user - validates credentials then sends OTP"""

    user = db.query(User).filter(User.email == credentials.email).first()

    if user:
        password_ok = verify_password(credentials.password, user.password_hash)
    else:
        verify_password(credentials.password, _DUMMY_HASH)   # same time as a wrong password
        password_ok = False

    if not password_ok:
        try:
            _ldb = _LogSessionLocal()
            _log_audit(
                _ldb,
                action="auth.login_failed",
                detail={"email": credentials.email},
            )
            _ldb.close()
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated"
        )

    # An older sha256 hash is replaced now, while the password is in hand.
    # This changes the token fingerprint, so the user's earlier tokens end;
    # verify-otp, next, issues the new one from this hash.
    if password_needs_upgrade(user.password_hash):
        user.password_hash = hash_password(credentials.password)

    otp_code = _set_new_otp(user, "login")
    db.commit()

    email_service.send_otp_email(
        to_email=user.email,
        full_name=user.full_name,
        otp_code=otp_code,
        context="login",
        db=db,
    )

    try:
        _ldb = _LogSessionLocal()
        _log_audit(
            _ldb,
            action="auth.login",
            user_id=user.id,
            user_email=user.email,
            user_role=user.role,
            entity_type="user",
            entity_id=user.id,
        )
        _ldb.close()
    except Exception:
        pass

    return {
        "status": "otp_sent",
        "message": "Verification code sent to your email",
        "email": user.email,
    }

class VerifyOTPRequest(BaseModel):
    email: str
    otp_code: str
    context: str  # 'register' or 'login'


@router.post("/verify-otp")
def verify_otp(request: VerifyOTPRequest, http_request: Request, db: Session = Depends(get_db)):
    """Verify OTP code for registration or login.

    A code allows OTP_MAX_WRONG wrong tries and is then voided; an address
    allows OTP_MAX_WRONG_PER_IP wrong tries across every account per
    OTP_IP_WINDOW_MINUTES. Without that, a 6-digit code alive for 10 minutes
    could simply be guessed.
    """
    ip = rate_limit.client_ip(http_request)
    if rate_limit.count(db, _OTP_IP_KIND, ip, OTP_IP_WINDOW_MINUTES) >= OTP_MAX_WRONG_PER_IP:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail="Too many wrong codes from this address. Please wait a few minutes and try again.")

    user = db.query(User).filter(User.email == request.email).first()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if not user.otp_code or user.otp_context != request.context:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No pending verification. Please request a new code.")

    if user.otp_expires < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Verification code has expired. Please request a new one.")

    if not hmac.compare_digest(str(user.otp_code), str(request.otp_code or "").strip()):
        rate_limit.hit(db, _OTP_IP_KIND, ip, commit=False)
        user.otp_attempts = (user.otp_attempts or 0) + 1
        if user.otp_attempts >= OTP_MAX_WRONG:
            user.otp_code = None
            user.otp_expires = None
            user.otp_context = None
            db.commit()
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                                detail="Too many wrong codes. This code no longer works -- please request a new one.")
        db.commit()
        left = OTP_MAX_WRONG - user.otp_attempts
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Invalid verification code. {left} {'try' if left == 1 else 'tries'} left.")

    # Clear OTP
    user.otp_code = None
    user.otp_expires = None
    user.otp_context = None
    user.otp_attempts = 0

    if request.context == "register":
        user.is_verified = True

    try:
        token = issue_token(user)
    except RuntimeError as e:                       # SECRET_KEY unset or a placeholder
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))

    db.commit()

    return {
        "status": "success",
        "message": "Verified successfully",
        "token": token,
        "user_id": user.id,
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
    }


class ResendOTPRequest(BaseModel):
    email: str
    context: str  # 'register' or 'login'


@router.post("/resend-otp")
def resend_otp(request: ResendOTPRequest, db: Session = Depends(get_db)):
    """Resend OTP code"""

    user = db.query(User).filter(User.email == request.email).first()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if request.context == "login" and not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is deactivated")

    otp_code = _set_new_otp(user, request.context)
    db.commit()

    email_service.send_otp_email(
        to_email=user.email,
        full_name=user.full_name,
        otp_code=otp_code,
        context=request.context,
        db=db,
    )

    return {"status": "success", "message": "New verification code sent to your email"}


def _get_user_from_token(authorization: Optional[str], db: Session) -> User:
    """The signed-in user from `Authorization: Bearer <token>`, or 401."""
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authorization header required")
    user = user_from_token(bearer_value(authorization), db)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Your session has ended. Please sign in again.")
    return user


@router.get("/user/{user_id}")
def get_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """A user's own details, for their profile and settings. Admins may read anyone's."""
    if current_user.id != user_id and current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only read your own details")

    user = db.query(User).filter(User.id == user_id).first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    return {
        "user_id": user.id,
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "display_name": user.display_name,
        "role": user.role,
        "is_active": user.is_active,
        "created_at": user.created_at,
        "phone": user.phone,
        "bio": user.bio,
        "avatar_url": user.avatar_url,
        "social_twitter": user.social_twitter,
        "social_facebook": user.social_facebook,
        "social_linkedin": user.social_linkedin,
        "social_instagram": user.social_instagram,
        "social_youtube": user.social_youtube,
    }

class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    display_name: Optional[str] = None   # Public nickname shown to visitors
    phone: Optional[str] = None
    bio: Optional[str] = None
    social_twitter: Optional[str] = None
    social_facebook: Optional[str] = None
    social_linkedin: Optional[str] = None
    social_instagram: Optional[str] = None
    social_youtube: Optional[str] = None


@router.put("/profile")
def update_profile(
    profile: ProfileUpdate,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db)
):
    """Update authenticated user's profile fields"""
    user = _get_user_from_token(authorization, db)
    for field, value in profile.dict().items():
        # Setting empty string clears the field; None means not provided → skip
        if value is None:
            continue
        setattr(user, field, value if value.strip() else None)
    user.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    return {
        "status": "success",
        "full_name": user.full_name,
        "display_name": user.display_name,
        "phone": user.phone,
        "bio": user.bio,
        "avatar_url": user.avatar_url,
        "social_twitter": user.social_twitter,
        "social_facebook": user.social_facebook,
        "social_linkedin": user.social_linkedin,
        "social_instagram": user.social_instagram,
        "social_youtube": user.social_youtube,
    }


@router.post("/profile/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db)
):
    """Upload a profile photo for the authenticated user"""
    user = _get_user_from_token(authorization, db)

    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Only image files (JPEG, PNG, GIF, WebP) are allowed")

    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 5MB")

    # Sanitise extension
    original_name = file.filename or "avatar"
    ext = original_name.rsplit(".", 1)[-1].lower() if "." in original_name else "jpg"
    if ext not in {"jpg", "jpeg", "png", "gif", "webp"}:
        ext = "jpg"

    filename = f"{user.id}.{ext}"
    filepath = os.path.join(AVATAR_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    avatar_url = f"/avatars/{filename}"
    user.avatar_url = avatar_url
    user.updated_at = datetime.utcnow()
    db.commit()

    return {"avatar_url": avatar_url}


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str
    confirm_password: str

class ForgotPasswordRequest(BaseModel):
    email: str

@router.post("/change-password")
def change_password(
    credentials: ChangePasswordRequest,
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
):
    """Change user password - requires old password verification.

    The new password ends every earlier token, this one included, so the
    answer carries a fresh token for the browser to keep.
    """
    user = _get_user_from_token(authorization, db)
    try:
        # Verify old password
        if not verify_password(credentials.old_password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Old password is incorrect"
            )
        
        # Verify new passwords match
        if credentials.new_password != credentials.confirm_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New passwords do not match"
            )
        
        # Validate password strength
        if len(credentials.new_password) < 6:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Password must be at least 6 characters"
            )
        
        # Update password
        user.password_hash = get_password_hash(credentials.new_password)
        user.updated_at = datetime.utcnow()
        db.commit()
        
        return {
            "status": "success",
            "message": "Password changed successfully",
            "token": issue_token(user),
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

@router.post("/forgot-password")
def forgot_password(request: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Request password reset email"""
    email = request.email
    
    try:
        user = db.query(User).filter(User.email == email).first()
        
        if not user:
            # Don't reveal if email exists for security
            return {
                "status": "success",
                "message": "If an account with this email exists, you will receive a password reset link"
            }
        
        # Generate reset token
        reset_token = secrets.token_urlsafe(32)
        reset_expires = datetime.utcnow() + timedelta(hours=1)
        
        # Store token in database
        user.password_reset_token = reset_token
        user.password_reset_expires = reset_expires
        db.commit()
        
        # Send email
        print(f"🔄 Attempting to send password reset email to {user.email}")
        email_service.send_password_reset_email(
            to_email=user.email,
            full_name=user.full_name,
            reset_token=reset_token,
            db=db
        )
        print(f"✅ Password reset email sent to {user.email}")
        
        return {
            "status": "success",
            "message": "If an account with this email exists, you will receive a password reset link"
        }
    except Exception as e:
        print(f"❌ Error in forgot_password: {str(e)}")
        import traceback
        traceback.print_exc()
        # Still return success to not reveal if email exists
        return {
            "status": "success",
            "message": "If an account with this email exists, you will receive a password reset link"
        }

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str
    confirm_password: str

@router.post("/reset-password")
def reset_password(request: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Reset password with token"""
    
    # Find user with this token
    user = db.query(User).filter(
        User.password_reset_token == request.token
    ).first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token"
        )
    
    # Check if token has expired
    if user.password_reset_expires < datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password reset link has expired. Please request a new one."
        )
    
    # Validate new passwords match
    if request.new_password != request.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New passwords do not match"
        )
    
    # Validate password strength
    if len(request.new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 6 characters"
        )
    
    # Update password
    user.password_hash = get_password_hash(request.new_password)
    user.password_reset_token = None
    user.password_reset_expires = None
    user.updated_at = datetime.utcnow()
    db.commit()
    
    return {
        "status": "success",
        "message": "Password has been reset successfully. Please log in with your new password."
    }

@router.post("/verify-reset-token")
def verify_reset_token(token: str = Query(...), db: Session = Depends(get_db)):
    """Verify if reset token is valid (POST)"""
    try:
        if not token:
            return {
                "status": "error",
                "valid": False,
                "message": "No token provided"
            }
        
        user = db.query(User).filter(User.password_reset_token == token).first()
        
        if not user:
            return {
                "status": "error",
                "valid": False,
                "message": "Invalid token"
            }
        
        if user.password_reset_expires < datetime.utcnow():
            return {
                "status": "error",
                "valid": False,
                "message": "Token has expired"
            }
        
        return {
            "status": "success",
            "valid": True,
            "email": user.email,
            "message": "Token is valid"
        }
    except Exception as e:
        print(f"❌ Error in verify_reset_token: {str(e)}")
        return {
            "status": "error",
            "valid": False,
            "message": f"Error: {str(e)}"
        }

@router.get("/verify-reset-token")
def verify_reset_token_get(token: str = Query(...), db: Session = Depends(get_db)):
    """Verify if reset token is valid (GET)"""
    try:
        if not token:
            return {
                "status": "error",
                "valid": False,
                "message": "No token provided"
            }
        
        user = db.query(User).filter(User.password_reset_token == token).first()
        
        if not user:
            return {
                "status": "error",
                "valid": False,
                "message": "Invalid token"
            }
        
        if user.password_reset_expires < datetime.utcnow():
            return {
                "status": "error",
                "valid": False,
                "message": "Token has expired"
            }
        
        return {
            "status": "success",
            "valid": True,
            "email": user.email,
            "message": "Token is valid"
        }
    except Exception as e:
        print(f"❌ Error in verify_reset_token_get: {str(e)}")
        return {
            "status": "error",
            "valid": False,
            "message": f"Error: {str(e)}"
        }

