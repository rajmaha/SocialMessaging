from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, UniqueConstraint, func, Table, JSON
from app.database import Base


api_server_user_access = Table(
    "api_server_user_access",
    Base.metadata,
    Column("api_server_id", Integer, ForeignKey("api_servers.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
)

api_server_team_access = Table(
    "api_server_team_access",
    Base.metadata,
    Column("api_server_id", Integer, ForeignKey("api_servers.id", ondelete="CASCADE"), primary_key=True),
    Column("team_id", Integer, ForeignKey("teams.id", ondelete="CASCADE"), primary_key=True),
)


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
    preserved_fields = Column(JSON, nullable=True)  # e.g. [{"key": "remote_user_id", "path": "data.id"}, {"key": "remote_user_name", "path": "data.name"}]
    # Response format configuration — how to detect success/failure from remote API body
    response_success_path = Column(String, nullable=True)  # e.g. "status" or "success" — path to boolean field
    response_message_path = Column(String, nullable=True, default="message")  # e.g. "message" — path to message string
    response_data_path = Column(String, nullable=True, default="data")  # e.g. "data" — path to data payload
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    spec_file_name = Column(String, nullable=True)


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
    login_response_data = Column(JSON, nullable=True)  # preserved data from login response

    __table_args__ = (
        UniqueConstraint("user_id", "api_server_id", name="uq_user_api_server"),
    )


class ApiServerEndpoint(Base):
    __tablename__ = "api_server_endpoints"

    id = Column(Integer, primary_key=True, index=True)
    api_server_id = Column(Integer, ForeignKey("api_servers.id", ondelete="CASCADE"), nullable=False, index=True)
    path = Column(String, nullable=False)
    method = Column(String, nullable=False)  # GET, POST, PUT, DELETE, PATCH
    summary = Column(String, nullable=True)
    fields = Column(JSON, nullable=True)  # array of {key, label, type, format, required, description, enum, default, location}
    source_type = Column(String, nullable=False, default="swagger")  # swagger, postman
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("api_server_id", "path", "method", name="uq_api_server_endpoint"),
    )
