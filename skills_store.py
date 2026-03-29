"""Backward-compatible module alias for app.skills_store."""

from .app import skills_store as _impl
import sys

sys.modules[__name__] = _impl
