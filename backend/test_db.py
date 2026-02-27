from app.database import SessionLocal
from app.models.ticket import Ticket
from app.models.call_records import CallRecording
import datetime

db = SessionLocal()

ticket = db.query(Ticket).first()
if ticket:
    new_recording = CallRecording(
        agent_id=ticket.assigned_to or 1,
        agent_name="System Admin",
        phone_number=ticket.phone_number,
        organization_id=ticket.organization_id,
        direction="inbound",
        disposition="ANSWERED",
        duration_seconds=120,
    )
    db.add(new_recording)
    db.commit()
    print("Added dummy CallRecording linked to phone: " + ticket.phone_number)

db.close()
