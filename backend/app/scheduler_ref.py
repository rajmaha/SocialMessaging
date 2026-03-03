# backend/app/scheduler_ref.py
"""
Holds a reference to the running APScheduler instance so that routes
can register/remove jobs without circular imports from main.py.
"""
from typing import Optional

scheduler = None  # Set by main.py at startup
