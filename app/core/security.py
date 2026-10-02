"""Optional HTTP Basic authentication, enabled by setting APP_PASSWORD."""

from __future__ import annotations

from secrets import compare_digest

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from app.core.config import Settings, get_settings

_basic = HTTPBasic(auto_error=False)


def require_auth(
    credentials: HTTPBasicCredentials | None = Depends(_basic),
    settings: Settings = Depends(get_settings),
) -> None:
    if not settings.app_password:
        return
    if credentials is not None:
        user_ok = compare_digest(credentials.username.encode(), settings.app_user.encode())
        pass_ok = compare_digest(credentials.password.encode(), settings.app_password.encode())
        if user_ok and pass_ok:
            return
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
        headers={"WWW-Authenticate": "Basic"},
    )
