import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import Session

from app.models.domain_agent import DomainAgent
from app.models.support import SupportMessage, SupportUser, SupportWebhook
from app.models.ticket import Ticket
from app.models.user import User
from app.models.widget_domain import WidgetDomain
from app.services import support_service as svc
from app.services.support_service import SupportError, SupportFile


# --- fixtures ----------------------------------------------------------------------

@pytest.fixture
def db(fresh_schema, secret_key):
    session = Session(bind=fresh_schema)
    yield session
    session.rollback()
    session.close()


@pytest.fixture(autouse=True)
def quiet(monkeypatch, tmp_path):
    """Run after-commit jobs at once; catch emails and live events; store files in tmp."""
    sent, events = [], []
    monkeypatch.setattr(svc, "run_later", lambda job: job())
    monkeypatch.setattr(svc, "mailer", lambda to, subject, html: sent.append((to, subject, html)) or True)
    monkeypatch.setattr(svc, "_broadcast", lambda ids, event: events.append((sorted(set(ids)), event)))
    monkeypatch.setattr(svc, "STORAGE_ROOT", str(tmp_path / "support"))
    return {"sent": sent, "events": events, "root": tmp_path / "support"}


def make_user(db, name="Ram Agent"):
    u = User(username=uuid.uuid4().hex[:10], email=f"{uuid.uuid4().hex[:8]}@agents.test",
             full_name=name, role="user", is_active=True)
    db.add(u)
    db.flush()
    return u


def make_domain(db, **over):
    d = WidgetDomain(domain=f"{uuid.uuid4().hex[:8]}.example.com", widget_key=uuid.uuid4().hex,
                     display_name="Example Ltd", is_active=1, support_enabled=1,
                     webhook_url="https://example.com/support-hook")
    for k, v in over.items():
        setattr(d, k, v)
    db.add(d)
    db.flush()
    return d


def make_person(db, domain, uid="site:7", email="sita@example.com", name="Sita Rai", phone=None):
    p = SupportUser(widget_domain_id=domain.id, uid=uid, email=email, name=name, phone=phone)
    db.add(p)
    db.flush()
    return p


def raise_one(db, domain, person, **data):
    base = {"subject": "Cannot print the salary sheet", "body": "It shows a blank page.",
            "priority": "high", "screen": "Payroll -> Salary sheet", "url": "https://oms.example.com/payroll"}
    base.update(data)
    files = base.pop("files", ())
    return svc.create_request(db, domain, person, base, files)


# --- raising a request ---------------------------------------------------------------

def test_create_request(db, quiet):
    d = make_domain(db)
    agent = make_user(db)
    db.add(DomainAgent(widget_domain_id=d.id, user_id=agent.id))
    p = make_person(db, d, phone="9800000000")
    t = raise_one(db, d, p)
    assert t.ticket_number.startswith("SUP-")
    assert (t.source, t.support_site_id, t.support_user_id) == ("support_widget", d.id, p.id)
    assert t.assigned_to is None and t.last_author == "customer"
    assert t.phone_number == "9800000000" and t.customer_name == "Sita Rai"
    assert t.support_screen == "Payroll -> Salary sheet"
    msgs = svc.messages(db, t)
    assert [(m.author_type, m.body) for m in msgs] == [("customer", "It shows a blank page.")]
    hook = db.query(SupportWebhook).filter_by(ticket_id=t.id).one()
    assert hook.event == "request_created" and hook.payload["uid"] == "site:7"
    assert hook.payload["status"] == "waiting"
    assert quiet["events"] and quiet["events"][0][0] == [agent.id]
    assert quiet["events"][0][1]["data"]["what"] == "created"
    assert quiet["sent"] == []   # the customer is not emailed about their own request


def test_tags_stripped_and_url_kept_only_when_http(db):
    d = make_domain(db)
    t = raise_one(db, d, make_person(db, d), subject="<b>Help</b> me", body="<script>x</script>hi",
                  url="javascript:alert(1)")
    assert t.support_subject == "Help me"
    assert svc.messages(db, t)[0].body == "xhi"
    assert t.support_url is None


def test_double_press_is_one_request(db):
    d = make_domain(db)
    p = make_person(db, d)
    rid = uuid.uuid4().hex
    one = raise_one(db, d, p, request_id=rid)
    two = raise_one(db, d, p, request_id=rid)
    assert one.id == two.id
    assert db.query(Ticket).filter_by(support_user_id=p.id).count() == 1


@pytest.mark.parametrize("data, sentence", [
    ({"subject": "Hi"}, "subject"),
    ({"body": "   "}, "Describe"),
    ({"priority": "panic"}, "Priority"),
])
def test_refusals(db, data, sentence):
    d = make_domain(db)
    with pytest.raises(SupportError) as e:
        raise_one(db, d, make_person(db, d), **data)
    assert sentence in e.value.message


def test_categories_offered_are_enforced(db):
    d = make_domain(db, support_categories=["Bug", "How to"])
    p = make_person(db, d)
    assert raise_one(db, d, p, category="bug").category == "Bug"
    with pytest.raises(SupportError):
        raise_one(db, d, p, category="Other")
    with pytest.raises(SupportError):
        raise_one(db, d, p, category="")


def test_free_category_when_none_offered(db):
    d = make_domain(db, support_categories=None)
    assert raise_one(db, d, make_person(db, d), category="Anything").category == "Anything"


def test_support_off_or_inactive_refused(db):
    for over in ({"support_enabled": 0}, {"is_active": 0}):
        d = make_domain(db, **over)
        with pytest.raises(SupportError) as e:
            raise_one(db, d, make_person(db, d))
        assert e.value.status_code == 403


def test_files_stored_and_checked(db, quiet):
    d = make_domain(db)
    p = make_person(db, d)
    t = raise_one(db, d, p, files=[SupportFile("../../etc/shot.png", b"\x89PNG data", "image/png")])
    att = svc.messages(db, t)[0].attachments
    assert att[0]["name"] == "shot.png" and att[0]["size"] == 9 and att[0]["type"] == "image/png"
    path = svc.file_path(att[0])
    assert path and os.path.exists(path) and path.startswith(str(quiet["root"]))
    assert svc.file_path({"path": "../../secret.txt"}) is None
    with pytest.raises(SupportError):
        raise_one(db, d, p, files=[SupportFile("run.exe", b"MZ")])
    with pytest.raises(SupportError):
        raise_one(db, d, p, files=[SupportFile("big.pdf", b"x" * (svc.MAX_FILE_BYTES + 1))])
    with pytest.raises(SupportError):
        raise_one(db, d, p, files=[SupportFile(f"{i}.png", b"x") for i in range(6)])


def test_no_webhook_without_an_address(db):
    d = make_domain(db, webhook_url=None)
    t = raise_one(db, d, make_person(db, d))
    assert db.query(SupportWebhook).filter_by(ticket_id=t.id).count() == 0


# --- replies, status ------------------------------------------------------------------

def test_agent_reply_emails_customer_and_queues_webhook(db, quiet):
    d = make_domain(db)
    p = make_person(db, d)
    t = raise_one(db, d, p)
    agent = make_user(db, "Ram Bahadur")
    m = svc.reply(db, t, "Please try again now.", agent=agent)
    assert m.author_type == "agent" and m.author_name == "Ram (Support)"
    db.refresh(t)
    assert t.last_author == "agent" and t.assigned_to == agent.id
    assert svc.status_word(t) == "replied"
    to, subject, html = quiet["sent"][-1]
    assert to == "sita@example.com" and t.ticket_number in subject and "Please try again now." in html
    hook = db.query(SupportWebhook).filter_by(ticket_id=t.id, event="reply").one()
    assert hook.payload["message"]["body"] == "Please try again now."


def test_customer_reply_tells_the_assignee(db, quiet):
    d = make_domain(db)
    p = make_person(db, d)
    t = raise_one(db, d, p)
    agent = make_user(db)
    svc.reply(db, t, "Try now.", agent=agent)
    quiet["events"].clear()
    svc.reply(db, t, "Still blank.", customer=p)
    assert quiet["events"][0][0] == [agent.id]
    assert svc.status_word(t) == "waiting"


def test_reply_needs_text_or_file(db):
    d = make_domain(db)
    p = make_person(db, d)
    t = raise_one(db, d, p)
    with pytest.raises(SupportError):
        svc.reply(db, t, "   ", customer=p)
    assert svc.reply(db, t, "", [SupportFile("a.png", b"x")], customer=p).attachments


def test_solved_then_reopened_within_seven_days(db, quiet):
    d = make_domain(db)
    p = make_person(db, d)
    t = raise_one(db, d, p)
    agent = make_user(db)
    assert svc.set_status(db, t, "solved", agent) is True
    assert svc.set_status(db, t, "solved", agent) is False          # nothing changed
    assert svc.status_word(t) == "solved" and t.solved_at is not None
    assert "solved" in quiet["sent"][-1][2]
    svc.reply(db, t, "It broke again.", customer=p)
    db.refresh(t)
    assert svc.status_word(t) == "waiting" and t.solved_at is None
    bodies = [m.body for m in svc.messages(db, t)]
    assert "Reopened by the customer." in bodies and bodies[-1] == "It broke again."


def test_reply_refused_after_seven_days(db):
    d = make_domain(db)
    p = make_person(db, d)
    t = raise_one(db, d, p)
    svc.set_status(db, t, "solved", make_user(db))
    t.solved_at = datetime.now(timezone.utc) - timedelta(days=8)
    db.commit()
    with pytest.raises(SupportError) as e:
        svc.reply(db, t, "Again?", customer=p)
    assert e.value.status_code == 409 and "Raise a new one" in e.value.message
    assert svc.customer_view(db, t)["can_reply"] is False


def test_agent_reopens(db, quiet):
    d = make_domain(db)
    p = make_person(db, d)
    t = raise_one(db, d, p)
    agent = make_user(db, "Gita Devi")
    svc.set_status(db, t, "solved", agent)
    svc.set_status(db, t, "pending", agent)
    assert svc.messages(db, t)[-1].body == "Reopened by Gita."
    assert "reopened" in quiet["sent"][-1][2]


def test_reply_double_press(db):
    d = make_domain(db)
    p = make_person(db, d)
    t = raise_one(db, d, p)
    rid = uuid.uuid4().hex
    a = svc.reply(db, t, "one", customer=p, request_id=rid)
    b = svc.reply(db, t, "one", customer=p, request_id=rid)
    assert a.id == b.id and len(svc.messages(db, t)) == 2


# --- what each side sees ----------------------------------------------------------------

def test_customer_view_hides_internal_things(db):
    d = make_domain(db)
    p = make_person(db, d)
    t = raise_one(db, d, p)
    agent = make_user(db, "Ram Bahadur")
    svc.reply(db, t, "Fixed.", agent=agent)
    # an internal follow-up note, as the workspace makes them
    db.add(Ticket(ticket_number="FLW-test-1", phone_number="-", parent_ticket_id=t.id,
                  app_type_data={"follow_up_note": "customer is rude"}))
    db.commit()
    view = svc.customer_view(db, t)
    flat = str(view)
    assert "rude" not in flat and "assigned" not in flat and str(agent.id) not in [str(v) for v in view.values()]
    assert set(view) == {"ticket_no", "subject", "status", "status_label", "category", "priority", "screen",
                         "url", "created_at", "updated_at", "can_reply", "messages"}
    assert [m["author_name"] for m in view["messages"]] == ["Sita Rai", "Ram (Support)"]


def test_find_for_customer_only_own(db):
    d = make_domain(db)
    other_domain = make_domain(db)
    p = make_person(db, d)
    q = make_person(db, d, uid="site:8", email="other@example.com")
    t = raise_one(db, d, p)
    assert svc.find_for_customer(db, d, p, t.ticket_number).id == t.id
    for domain, person in ((d, q), (other_domain, p)):
        with pytest.raises(SupportError) as e:
            svc.find_for_customer(db, domain, person, t.ticket_number)
        assert e.value.status_code == 404


def test_customer_requests_list(db):
    d = make_domain(db)
    p = make_person(db, d)
    for i in range(3):
        raise_one(db, d, p, subject=f"Request number {i}")
    got = svc.customer_requests(db, d, p, page=1, per_page=2)
    assert got["total"] == 3 and got["has_more"] is True and len(got["items"]) == 2
    assert got["items"][0]["status_label"] == "Waiting for support"


def test_agent_conversation_names_agents_in_full(db):
    d = make_domain(db)
    p = make_person(db, d)
    t = raise_one(db, d, p)
    svc.reply(db, t, "Hello", agent=make_user(db, "Ram Bahadur"))
    conv = svc.agent_conversation(db, t)
    assert conv["site"]["name"] == "Example Ltd" and conv["customer"]["signed"] is True
    assert conv["messages"][-1]["author_name"] == "Ram Bahadur"


def test_not_a_support_ticket(db):
    t = Ticket(ticket_number="TCK-x", phone_number="980")
    db.add(t)
    db.commit()
    with pytest.raises(SupportError):
        svc.reply(db, t, "hi", agent=make_user(db))
    assert svc.set_status(db, t, "solved", make_user(db)) is False
