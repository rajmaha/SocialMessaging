from sqlalchemy import Column, Integer, String, Boolean, JSON, DateTime, func
from app.database import Base

class DynamicField(Base):
    __tablename__ = "dynamic_fields"

    id = Column(Integer, primary_key=True, index=True)
    application_type = Column(String, index=True, nullable=False)
    
    # Machine-readable key (e.g., 'room_number', 'patient_id')
    field_name = Column(String, nullable=False)
    
    # Human-readable label (e.g., 'Room Number', 'Patient ID')
    field_label = Column(String, nullable=False)
    
    # field_type: text, textarea, select, checkbox, date, time
    field_type = Column(String, nullable=False, default="text")
    
    # JSON list of options for 'select' field types
    options = Column(JSON, nullable=True)
    
    display_order = Column(Integer, default=0)
    is_required = Column(Boolean, default=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())
