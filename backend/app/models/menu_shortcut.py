from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint, func
from app.database import Base


class UserMenuShortcut(Base):
    """A user's favourite or recently opened sidebar menu.

    Only the menu's path is stored. Label, icon and whether the user may see it
    are read off the sidebar the user already has, so a stored path grants nothing.
    """
    __tablename__ = "user_menu_shortcuts"
    __table_args__ = (UniqueConstraint("user_id", "kind", "path", name="uq_user_menu_shortcut"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(10), nullable=False)  # favorite | recent
    path = Column(String(500), nullable=False)
    position = Column(Integer, nullable=False, default=0)  # favourites order
    visited_at = Column(DateTime(timezone=True), server_default=func.now())  # recents order
