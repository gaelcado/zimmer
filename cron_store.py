"""Compatibility shim."""

from .app import cron_store as _impl
import sys as _sys
_sys.modules[__name__] = _impl
