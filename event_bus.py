"""Compatibility shim."""

from .app import event_bus as _impl
import sys as _sys
_sys.modules[__name__] = _impl
