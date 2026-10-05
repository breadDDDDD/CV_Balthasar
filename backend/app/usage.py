"""Token and cost metadata for every Gemini call, written as one JSON line to stdout.

On Cloud Run each line becomes a structured Cloud Logging entry (free tier), which can
be routed to BigQuery with a log sink for long-term SQL (see README). Records hold
counts and outcomes only: never CV text, prompts or replies, and never the raw address.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sys
import time
from contextvars import ContextVar

EVENT = "ai_usage"

# USD per 1M tokens (ai.google.dev/gemini-api/docs/pricing). Output includes thinking.
PRICES = {
    "gemini-3-flash-preview": {"input": 0.50, "cached": 0.05, "output": 3.00},
}

# Per-request fields (action, visitor) set by the caller before the model is reached.
_context: ContextVar[dict] = ContextVar("ai_usage_context", default={})

# Without a configured salt the visitor hash is only stable within one instance.
_salt = (os.environ.get("USAGE_HASH_SALT", "").strip() or secrets.token_hex(16)).encode()


def visitor(ip: str) -> str:
    """A salted, truncated hash: groups calls per visitor without storing the address."""
    return hmac.new(_salt, ip.encode(), hashlib.sha256).hexdigest()[:16]


def bind(**fields) -> None:
    _context.set({**_context.get(), **fields})


def estimate_cost(model: str, input_tokens: int, cached_tokens: int, output_tokens: int) -> float | None:
    price = PRICES.get(model)
    if price is None:
        return None
    billed_input = max(input_tokens - cached_tokens, 0)
    cost = billed_input * price["input"] + cached_tokens * price["cached"] + output_tokens * price["output"]
    return round(cost / 1_000_000, 8)


def record(model: str, usage_metadata: object, started: float, outcome: str = "ok", finish_reason: str = "") -> dict:
    """Write one usage line and return it. `usage_metadata` may be None (failed call)."""

    def count(name: str) -> int:
        return int(getattr(usage_metadata, name, None) or 0)

    input_tokens = count("prompt_token_count")
    cached_tokens = count("cached_content_token_count")
    response_tokens = count("candidates_token_count")
    thinking_tokens = count("thoughts_token_count")
    entry = {
        "severity": "INFO" if outcome == "ok" else "WARNING",
        "message": f"{EVENT} {outcome}",
        "event": EVENT,
        **_context.get(),
        "model": model,
        "outcome": outcome,
        "finish_reason": finish_reason,
        "input_tokens": input_tokens,
        "cached_tokens": cached_tokens,
        "response_tokens": response_tokens,
        "thinking_tokens": thinking_tokens,
        "output_tokens": response_tokens + thinking_tokens,
        "total_tokens": count("total_token_count") or input_tokens + response_tokens + thinking_tokens,
        "latency_ms": int((time.monotonic() - started) * 1000),
    }
    entry["est_cost_usd"] = estimate_cost(model, input_tokens, cached_tokens, entry["output_tokens"])
    try:
        sys.stdout.write(json.dumps(entry, separators=(",", ":")) + "\n")
        sys.stdout.flush()
    except Exception:
        pass  # metadata must never break a request
    return entry
