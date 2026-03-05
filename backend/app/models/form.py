from sqlalchemy import Column, Integer, String, Text, Boolean, JSON, DateTime, ForeignKey, UniqueConstraint, func
from app.database import Base


class Form(Base):
    __tablename__ = "forms"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    slug = Column(String, unique=True, nullable=False, index=True)
    description = Column(Text, nullable=True)
    success_message = Column(Text, default="Thank you for your submission!")
    storage_type = Column(String, nullable=False, default="local")  # local, api
    is_published = Column(Boolean, default=False)
    require_otp = Column(Boolean, default=False)
    api_server_id = Column(Integer, ForeignKey("api_servers.id"), nullable=True)
    api_create_method = Column(String, nullable=True)
    api_list_method = Column(String, nullable=True)
    api_detail_method = Column(String, nullable=True)
    api_update_method = Column(String, nullable=True)
    api_delete_method = Column(String, nullable=True)
    api_list_columns = Column(JSON, nullable=True)
    api_record_id_path = Column(String, nullable=True, default="data.id")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())


class FormField(Base):
    __tablename__ = "form_fields"

    id = Column(Integer, primary_key=True, index=True)
    form_id = Column(Integer, ForeignKey("forms.id", ondelete="CASCADE"), nullable=False, index=True)
    field_label = Column(String, nullable=False)
    field_key = Column(String, nullable=False)
    field_type = Column(String, nullable=False, default="text")
    placeholder = Column(String, nullable=True)
    is_required = Column(Boolean, default=False)
    display_order = Column(Integer, default=0)
    default_value = Column(String, nullable=True)
    options = Column(JSON, nullable=True)
    validation_rules = Column(JSON, nullable=True)
    api_endpoint = Column(String, nullable=True)
    api_value_key = Column(String, nullable=True)
    api_label_key = Column(String, nullable=True)
    condition = Column(JSON, nullable=True)
    condition_logic = Column(String, nullable=True, default="AND")  # AND, OR
    api_params = Column(JSON, nullable=True)  # e.g. [{"param": "departmentId", "source_field_key": "department"}]
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("form_id", "field_key", name="uq_form_field_key"),
    )


class FormSubmission(Base):
    __tablename__ = "form_submissions"

    id = Column(Integer, primary_key=True, index=True)
    form_id = Column(Integer, ForeignKey("forms.id", ondelete="CASCADE"), nullable=False, index=True)
    data = Column(JSON, nullable=False)
    submitter_email = Column(String, nullable=True)
    submitted_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())
