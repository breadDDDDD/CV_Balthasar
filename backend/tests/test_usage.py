import json
from types import SimpleNamespace

import pytest
from google import genai

from app import ai, usage
from app.config import Settings, get_settings
from app.main import app

# Captured at import, before the autouse fixture swaps it for a guard.
REAL_GENERATE = ai._generate


def fake_client(text, finish="STOP", **counts):
    meta = SimpleNamespace(
        prompt_token_count=counts.get("prompt", 1000),
        cached_content_token_count=counts.get("cached", 0),
        candidates_token_count=counts.get("candidates", 200),
        thoughts_token_count=counts.get("thoughts", 50),
        total_token_count=None,
    )
    response = SimpleNamespace(
        text=text,
        prompt_feedback=None,
        candidates=[SimpleNamespace(finish_reason=SimpleNamespace(name=finish))],
        usage_metadata=meta,
    )
    models = SimpleNamespace(generate_content=lambda **kwargs: response)
    return lambda **kwargs: SimpleNamespace(models=models)


def usage_lines(capsys):
    lines = [json.loads(l) for l in capsys.readouterr().out.splitlines() if l.startswith("{")]
    return [l for l in lines if l.get("event") == usage.EVENT]


def test_cost_estimate():
    # 1000 input (200 cached) at $0.50/M + $0.05/M, 250 output at $3/M.
    assert usage.estimate_cost("gemini-3-flash-preview", 1000, 200, 250) == pytest.approx(
        (800 * 0.5 + 200 * 0.05 + 250 * 3) / 1e6
    )
    assert usage.estimate_cost("unknown-model", 1, 0, 1) is None


def test_visitor_hash_is_stable_and_not_the_address():
    assert usage.visitor("1.2.3.4") == usage.visitor("1.2.3.4") != usage.visitor("1.2.3.5")
    assert "1.2.3.4" not in usage.visitor("1.2.3.4")


def test_chat_logs_tokens_without_content(client, cv, monkeypatch, capsys):
    cfg = Settings(gemini_api_key="fake", ai_mock=False)
    app.dependency_overrides[get_settings] = lambda: cfg
    monkeypatch.setattr(ai, "_generate", REAL_GENERATE)
    monkeypatch.setattr(genai, "Client", fake_client(json.dumps({"reply": "secret reply", "edits": []})))
    capsys.readouterr()

    res = client.post("/api/chat", json={"cv": cv, "action": "review"})
    assert res.status_code == 200, res.text

    (entry,) = usage_lines(capsys)
    assert entry["action"] == "review" and entry["outcome"] == "ok"
    assert entry["model"] == "gemini-3-flash-preview"
    assert (entry["input_tokens"], entry["output_tokens"], entry["total_tokens"]) == (1000, 250, 1250)
    assert entry["est_cost_usd"] == pytest.approx((1000 * 0.5 + 250 * 3) / 1e6)
    assert len(entry["visitor"]) == 16
    raw = json.dumps(entry)
    assert "secret reply" not in raw and "Jane" not in raw and "testclient" not in raw


def test_failed_calls_are_still_logged(client, monkeypatch, capsys):
    cfg = Settings(gemini_api_key="fake", ai_mock=False)
    app.dependency_overrides[get_settings] = lambda: cfg
    monkeypatch.setattr(ai, "_generate", REAL_GENERATE)
    monkeypatch.setattr(genai, "Client", fake_client("", finish="MAX_TOKENS", thoughts=4000))
    capsys.readouterr()

    res = client.post("/api/parse/text", json={"text": "Jane Doe\nEngineer", "ai": True})
    assert res.status_code == 502

    (entry,) = usage_lines(capsys)
    assert entry["action"] == "parse" and entry["outcome"] == "max_tokens"
    assert entry["thinking_tokens"] == 4000 and entry["severity"] == "WARNING"


def test_mock_mode_logs_nothing(client, cv, capsys):
    capsys.readouterr()
    assert client.post("/api/chat", json={"cv": cv, "action": "rewrite"}).status_code == 200
    assert usage_lines(capsys) == []
