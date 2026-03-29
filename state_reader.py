"""Compatibility shim."""

from .app import state_reader as _impl
import sys as _sys
_sys.modules[__name__] = _impl
