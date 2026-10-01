import os

# Must run before the app is imported: an empty value stops python-dotenv from
# loading the real key, so the test suite can never spend Gemini budget.
os.environ["GEMINI_API_KEY"] = ""
os.environ["AI_MOCK"] = "0"

import pytest
from fastapi.testclient import TestClient

from app import ai, security
from app.config import Settings, get_settings
from app.main import app

ORIGIN = "http://localhost:5173"

SAMPLE_TXT = """Jane Doe
Senior Data Engineer
+62 812 3456 7890 | jane.doe@example.com | Jakarta, Indonesia | github.com/janedoe

Data engineer with eight years of experience building analytics platforms.
Focused on reliable pipelines and clear communication with stakeholders.

EXPERIENCE
Acme Corp, Data Engineer    Jan 2022 - Present
Platform Team
• Built a streaming pipeline that cut reporting latency by 40% .
• Responsible for the nightly batch jobs
  that load the finance warehouse..
- Led a team of 5 engineers to migrate 120 dashboards.

Globex    2019 - 2021
Analyst
* Worked on ad-hoc reports

EDUCATION
State University, BSc Computer Science    2015 - 2019
GPA: 3.8/4

SKILLS
Languages: Python, SQL, Go
Tools: Airflow, dbt, Docker
"""


@pytest.fixture(autouse=True)
def no_real_ai(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("tests must never call Gemini")

    monkeypatch.setattr(ai, "_generate", forbidden)
    ai.limiter.__init__()
    security.windows.reset()


@pytest.fixture
def settings():
    return Settings(gemini_api_key="", ai_mock=True)


@pytest.fixture
def client(settings):
    app.dependency_overrides[get_settings] = lambda: settings
    browser = TestClient(app, headers={"Origin": ORIGIN})
    # Behaves like the frontend: fetch a session ticket once and send it with every call.
    browser.headers["X-CV-Session"] = browser.get("/api/session").json()["token"]
    yield browser
    app.dependency_overrides.clear()


@pytest.fixture
def cv(client):
    res = client.post("/api/parse/text", json={"text": SAMPLE_TXT})
    assert res.status_code == 200, res.text
    return res.json()["cv"]
