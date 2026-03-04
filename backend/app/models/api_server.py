from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, UniqueConstraint, func
from app.database import Base


class ApiServer(Base):
    __tablename__ = "api_servers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    base_url = Column(String, nullable=False)
    auth_type = Column(String, nullable=False, default="none")  # none, api_key_plus_token, basic, bearer, api_key_only
    api_key_header = Column(String, nullable=True)
    api_key_value = Column(String, nullable=True)
    token_header = Column(String, nullable=True)
    login_endpoint = Column(String, nullable=True)
    login_username_field = Column(String, nullable=True, default="username")
    login_password_field = Column(String, nullable=True, default="password")
    token_response_path = Column(String, nullable=True, default="data.token")
    request_content_type = Column(String, nullable=False, default="json")  # json, formdata
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class UserApiCredential(Base):
    __tablename__ = "user_api_credentials"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    api_server_id = Column(Integer, ForeignKey("api_servers.id"), nullable=False)
    username = Column(String, nullable=False)
    password = Column(String, nullable=False)
    token = Column(String, nullable=True)
    token_expires_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, default=True)

    __table_args__ = (
        UniqueConstraint("user_id", "api_server_id", name="uq_user_api_server"),
    )
