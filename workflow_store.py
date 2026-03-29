"""Compatibility shim."""

from .app import workflow_store as _impl
import sys as _sys
_sys.modules[__name__] = _impl
