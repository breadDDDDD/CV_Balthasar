"""Abuse protection: who may call the API and how often.

Everything is in memory and per instance (nothing is stored), which is why the
deploy instructions cap Cloud Run at one instance.

Honest limit: a browser app cannot keep a secret, so "only the frontend may call"
cannot be made absolute. These checks stop other websites, casual scripts and
replayed requests; the rate limits and the provider-side quota bound what a
determined caller who imitates the frontend can spend.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import threading
import time
from collections import defaultdict, deque

from fastapi import Request

from .config import Settings


def client_ip(request: Request, trusted_hops: int) -> str:
    """The caller's address. Behind Cloud Run the platform appends the real address
    to X-Forwarded-For, so only the last `trusted_hops` entries can be believed;
    anything before them is supplied by the caller and would let it dodge limits."""
    forwarded = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
    if trusted_hops > 0 and len(forwarded) >= trusted_hops:
        return forwarded[-trusted_hops]
    return request.client.host if request.client else "unknown"


class SlidingWindow:
    """Counts hits per key over a moving time window."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._last_sweep = time.time()

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()

    def hit(self, key: str, limit: int, seconds: float) -> int:
        """Record a hit. Returns 0 when allowed, else the seconds to wait."""
        now = time.time()
        with self._lock:
            if now - self._last_sweep > 300:  # keep memory flat under many distinct callers
                self._last_sweep = now
                for stale in [k for k, w in self._hits.items() if not w or now - w[-1] > 86400]:
                    del self._hits[stale]
            window = self._hits[key]
            while window and now - window[0] > seconds:
                window.popleft()
            if len(window) >= limit:
                return int(seconds - (now - window[0])) + 1
            window.append(now)
            return 0


windows = SlidingWindow()


def origin_allowed(request: Request, cfg: Settings) -> bool:
    """True when the request comes from the deployed frontend (or from this API's own
    pages, e.g. /docs). Browsers set Origin themselves and scripts on other sites
    cannot change it."""
    origin = request.headers.get("origin")
    if origin is None:
        # Same-origin GETs carry no Origin header; fall back to the Referer.
        referer = request.headers.get("referer", "")
        origin = "/".join(referer.split("/", 3)[:3]) if referer else ""
    if not origin:
        return False
    own = f"{request.url.scheme}://{request.headers.get('host', '')}"
    return origin in cfg.allowed_origins or origin == own


# ------------------------------------------------------------ session tokens
# A short-lived signed ticket the frontend fetches (from an allowed origin) and
# sends with every AI call. It is bound to the caller's address, so a copied
# token is useless elsewhere and expires in minutes. Stateless: only the
# signature is checked, nothing is remembered.

_FALLBACK_SECRET = secrets.token_bytes(32)  # per instance when SESSION_SECRET is unset


def _secret(cfg: Settings) -> bytes:
    return cfg.session_secret.encode() if cfg.session_secret else _FALLBACK_SECRET


def _sign(cfg: Settings, expires: int, ip: str) -> str:
    mac = hmac.new(_secret(cfg), f"{expires}|{ip}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).decode().rstrip("=")


def issue_token(cfg: Settings, ip: str) -> tuple[str, int]:
    expires = int(time.time()) + cfg.session_ttl_seconds
    return f"{expires}.{_sign(cfg, expires, ip)}", cfg.session_ttl_seconds


def token_valid(cfg: Settings, token: str | None, ip: str) -> bool:
    try:
        raw_expires, signature = (token or "").split(".", 1)
        expires = int(raw_expires)
    except ValueError:
        return False
    if expires < time.time():
        return False
    return hmac.compare_digest(signature, _sign(cfg, expires, ip))
