"""Compatibility shim."""

from .app import honcho_reader as _impl
import sys as _sys
_sys.modules[__name__] = _impl
