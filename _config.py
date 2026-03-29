"""Compatibility shim."""

from .app import _config as _impl
import sys as _sys
_sys.modules[__name__] = _impl
