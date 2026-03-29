"""Compatibility shim."""

from .app import workflow_engine as _impl
import sys as _sys
_sys.modules[__name__] = _impl
