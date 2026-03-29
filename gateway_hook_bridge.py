"""Compatibility shim."""

from .app import gateway_hook_bridge as _impl
import sys as _sys
_sys.modules[__name__] = _impl
