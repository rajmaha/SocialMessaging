from sqlalchemy import Column, Integer, String, Text, Boolean, Float, Date, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import relationship
from app.database import Base


class PMSProject(Base):
    __tablename__ = "pms_projects"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text)
    status = Column(String, default="planning")
    start_date = Column(Date)
    end_date = Column(Date)
    color = Column(String, default="#6366f1")
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    team_id = Column(Integer, ForeignKey("teams.id", ondelete="SET NULL"))
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    owner = relationship("User", foreign_keys=[owner_id])
    members = relationship("PMSProjectMember", back_populates="project", cascade="all, delete-orphan")
    milestones = relationship("PMSMilestone", back_populates="project", cascade="all, delete-orphan")
    tasks = relationship("PMSTask", back_populates="project", cascade="all, delete-orphan")


class PMSProjectMember(Base):
    __tablename__ = "pms_project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id"),)
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("pms_projects.id", ondelete="CASCADE"))
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    role = Column(String, default="developer")
    added_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    added_at = Column(DateTime, server_default=func.now())
    hours_per_day = Column(Float, default=7.0)

    project = relationship("PMSProject", back_populates="members")
    user = relationship("User", foreign_keys=[user_id])


class PMSMilestone(Base):
    __tablename__ = "pms_milestones"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("pms_projects.id", ondelete="CASCADE"))
    name = Column(String, nullable=False)
    due_date = Column(Date)
    status = Column(String, default="pending")
    color = Column(String, default="#f59e0b")

    project = relationship("PMSProject", back_populates="milestones")
    tasks = relationship("PMSTask", back_populates="milestone")


class PMSTask(Base):
    __tablename__ = "pms_tasks"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("pms_projects.id", ondelete="CASCADE"))
    milestone_id = Column(Integer, ForeignKey("pms_milestones.id", ondelete="SET NULL"), nullable=True)
    parent_task_id = Column(Integer, ForeignKey("pms_tasks.id", ondelete="CASCADE"), nullable=True)
    title = Column(String, nullable=False)
    description = Column(Text)
    stage = Column(String, default="development")
    priority = Column(String, default="medium")
    assignee_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    start_date = Column(Date)
    due_date = Column(Date)
    estimated_hours = Column(Float, default=0)
    actual_hours = Column(Float, default=0)
    position = Column(Integer, default=0)
    ticket_id = Column(Integer, nullable=True)
    crm_deal_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    project = relationship("PMSProject", back_populates="tasks")
    milestone = relationship("PMSMilestone", back_populates="tasks")
    assignee = relationship("User", foreign_keys=[assignee_id])
    subtasks = relationship("PMSTask", back_populates="parent", foreign_keys=[parent_task_id])
    parent = relationship("PMSTask", back_populates="subtasks", remote_side=[id])
    dependencies = relationship("PMSTaskDependency", foreign_keys="PMSTaskDependency.task_id", cascade="all, delete-orphan")
    comments = relationship("PMSTaskComment", back_populates="task", cascade="all, delete-orphan")
    timelogs = relationship("PMSTaskTimeLog", back_populates="task", cascade="all, delete-orphan")
    attachments = relationship("PMSTaskAttachment", back_populates="task", cascade="all, delete-orphan")
    labels = relationship("PMSTaskLabel", back_populates="task", cascade="all, delete-orphan")
    workflow_history = relationship("PMSWorkflowHistory", back_populates="task", cascade="all, delete-orphan")


class PMSTaskDependency(Base):
    __tablename__ = "pms_task_dependencies"
    __table_args__ = (UniqueConstraint("task_id", "depends_on_id"),)
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("pms_tasks.id", ondelete="CASCADE"))
    depends_on_id = Column(Integer, ForeignKey("pms_tasks.id", ondelete="CASCADE"))
    type = Column(String, default="finish_to_start")


class PMSTaskComment(Base):
    __tablename__ = "pms_task_comments"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("pms_tasks.id", ondelete="CASCADE"))
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    task = relationship("PMSTask", back_populates="comments")
    user = relationship("User", foreign_keys=[user_id])


class PMSTaskTimeLog(Base):
    __tablename__ = "pms_task_timelogs"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("pms_tasks.id", ondelete="CASCADE"))
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    hours = Column(Float, nullable=False)
    log_date = Column(Date, server_default=func.current_date())
    note = Column(String)
    created_at = Column(DateTime, server_default=func.now())

    task = relationship("PMSTask", back_populates="timelogs")
    user = relationship("User", foreign_keys=[user_id])


class PMSTaskAttachment(Base):
    __tablename__ = "pms_task_attachments"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("pms_tasks.id", ondelete="CASCADE"))
    file_path = Column(String, nullable=False)
    file_name = Column(String, nullable=False)
    file_size = Column(Integer, default=0)
    uploaded_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    created_at = Column(DateTime, server_default=func.now())

    task = relationship("PMSTask", back_populates="attachments")


class PMSTaskLabel(Base):
    __tablename__ = "pms_task_labels"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("pms_tasks.id", ondelete="CASCADE"))
    name = Column(String, nullable=False)
    color = Column(String, default="#6366f1")
    label_definition_id = Column(Integer, ForeignKey("pms_label_definitions.id", ondelete="CASCADE"), nullable=True)

    task = relationship("PMSTask", back_populates="labels")


class PMSWorkflowHistory(Base):
    __tablename__ = "pms_workflow_history"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("pms_tasks.id", ondelete="CASCADE"))
    from_stage = Column(String)
    to_stage = Column(String, nullable=False)
    moved_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    note = Column(Text)
    created_at = Column(DateTime, server_default=func.now())

    task = relationship("PMSTask", back_populates="workflow_history")
    actor = relationship("User", foreign_keys=[moved_by])


class PMSLabelDefinition(Base):
    __tablename__ = "pms_label_definitions"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    color = Column(String, default="#6366f1")
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class PMSAlert(Base):
    __tablename__ = "pms_alerts"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("pms_tasks.id", ondelete="CASCADE"))
    project_id = Column(Integer, ForeignKey("pms_projects.id", ondelete="CASCADE"))
    type = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False)
    notified_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    created_at = Column(DateTime, server_default=func.now())


class PMSAuditLog(Base):
    __tablename__ = "pms_audit_logs"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("pms_projects.id", ondelete="CASCADE"))
    task_id = Column(Integer, nullable=True)
    action_type = Column(String, nullable=False)
    actor_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    details = Column(Text)
    created_at = Column(DateTime, server_default=func.now())

    actor = relationship("User", foreign_keys=[actor_id])
