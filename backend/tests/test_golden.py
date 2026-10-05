"""Shared fixtures for the browser ports of the renderer and the quick check.

The UI draws the preview and runs the review in TypeScript (frontend/src/render.ts and
review.ts). Both sides test against the same files, so any drift fails one of the suites.
After a deliberate change to the template, render/common.py or review.py, regenerate with
UPDATE_GOLDEN=1 uv run pytest tests/test_golden.py and port the change to the frontend.
"""

import json
import os
from pathlib import Path

import pytest

from app.models import CV
from app.render.common import export_basename
from app.render.html import render_html
from app.review import review_cv

GOLDEN = Path(__file__).parent / "golden"
CASES = sorted(p.name.removesuffix(".cv.json") for p in GOLDEN.glob("*.cv.json"))


def expected(raw: dict) -> dict:
    cv = CV.model_validate(raw)
    return {
        "html": render_html(cv),
        "review": review_cv(cv).model_dump(mode="json"),
        "filename": export_basename(cv, None),
    }


@pytest.mark.parametrize("case", CASES)
def test_golden(case):
    actual = expected(json.loads((GOLDEN / f"{case}.cv.json").read_text("utf-8")))
    path = GOLDEN / f"{case}.expected.json"
    if os.environ.get("UPDATE_GOLDEN"):
        path.write_text(json.dumps(actual, indent=2, ensure_ascii=False) + "\n", "utf-8", newline="\n")
    assert path.exists(), f"missing {path.name}: run with UPDATE_GOLDEN=1"
    assert json.loads(path.read_text("utf-8")) == actual
