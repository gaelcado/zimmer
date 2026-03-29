"""Compatibility shim."""

from ..app.routes import honcho as _impl
import sys as _sys
_sys.modules[__name__] = _impl
