# Auto Tester — implementation guide (PRD → code)

Auto Tester is the new name of "Zedu Preflight". This guide maps every PRD
requirement to the code, says what existed before, and gives the full source
for everything that was missing, file by file.

> Status: everything in Parts 1–3 is implemented on the `feat/prd-implementation`
> branch. The "Missing" labels in Part 0 describe the state **before** that branch.
> What still needs a human: confirm the Zedu selectors in `e2e/pages/zedu.ts`
> (marked `TODO`), run migration 0002 in Supabase, add the GitHub `staging`
> environment secrets, and get the Zedu webhook URL for alerts.

One architectural note first. The PRD says "Next.js API routes on Vercel".
The repo already diverged: the results API is FastAPI on Coolify
(https://tester.zedu.chat) and Next.js is the dashboard only. Keep that. It
satisfies every requirement and changing it now would cost a day.

---

## Part 0 — Gap analysis

| ID    | Requirement (short)                                | Pri | Status                   | Where / what to build                                                            |
| ----- | -------------------------------------------------- | --- | ------------------------ | -------------------------------------------------------------------------------- |
| FR-1  | Playwright project, folder per feature             | P0  | **Missing**              | `e2e/` (Part 3)                                                                  |
| FR-2  | Manifest: name, feature, enabled                   | P0  | **Missing**              | `e2e/manifest.json`, read by Playwright config and the Tests page                |
| FR-3  | Login once per role, saved state, env creds        | P0  | **Missing**              | `e2e/tests/global.setup.ts`, `e2e/fixtures/users.ts`                             |
| FR-4  | Two isolated contexts (A sends, B sees)            | P0  | **Missing**              | `e2e/fixtures/test.ts`                                                           |
| FR-5  | Run-ID prefixed data + cleanup                     | P0  | **Missing**              | `unique()` and `cleanup()` fixtures                                              |
| FR-6  | One test per core flow                             | P0  | **Missing**              | 6 specs in Part 3.7 (selectors to confirm on staging)                            |
| FR-7  | Health check → "Environment down"                  | P1  | **Missing**              | `e2e/scripts/health-check.mjs` + workflow step                                   |
| FR-8  | axe-core / visual checks                           | P2  | Skip                     | Out of the four-day scope                                                        |
| FR-9  | `workflow_dispatch` with env + tag                 | P0  | **Missing**              | `.github/workflows/smoke.yml`                                                    |
| FR-10 | Nightly schedule                                   | P0  | **Missing**              | same workflow                                                                    |
| FR-11 | Run on push/PR of this repo                        | P0  | **Missing**              | same workflow                                                                    |
| FR-12 | Retry ×2, screenshot on fail, trace on first retry | P0  | **Missing**              | `e2e/playwright.config.ts`                                                       |
| FR-13 | Run from Zedu repos                                | P1  | Partial                  | `examples/auto-tester-workflow.yml` exists; leads' approval needed               |
| FR-14 | Re-run button                                      | P1  | **Missing**              | `app/github.py`, `POST /api/runs/{id}/rerun`, button on run page                 |
| FR-15 | Results API with project key                       | P0  | Done                     | `app/routers/results.py` — add `PATCH /api/runs/{id}` for Running                |
| FR-16 | Login (Supabase)                                   | P0  | Done                     | Needed the `proxy.ts` matcher fix (`auth/` excluded). Add email allow-list       |
| FR-17 | Verdict logic incl. Running                        | P0  | Partial                  | `verdict.py` is correct; "Running" needs the register-then-finish flow           |
| FR-18 | Project cards + run history table                  | P0  | Partial                  | Add run ID + status columns, auto-refresh while running                          |
| FR-19 | Run details with evidence                          | P0  | Done\*                   | \*Dev-mode screenshots are broken (proxy corrupts binaries); fixed in Part 2.3   |
| FR-20 | Flaky shown apart, with owner                      | P1  | **Missing**              | `owner` column, flaky section on run page, poster detects flaky                  |
| FR-21 | Copy bug report                                    | P1  | Partial                  | Add evidence link, feature, owner, repro command                                 |
| FR-22 | Starter Tests page                                 | P1  | **Missing**              | `GET /api/tests`, `frontend/src/app/tests/page.tsx`                              |
| FR-23 | Trend chart                                        | P2  | Skip                     | Later                                                                            |
| FR-24 | Alert on failed run                                | P1  | **Missing**              | `app/alerts.py` webhook; channel/format to confirm with leads                    |
| FR-25 | Connect Repository form                            | P1  | **Missing** (API exists) | `ConnectProjectDialog.tsx`; staging allow-list in backend                        |
| FR-26 | Release sign-off                                   | P1  | **Missing**              | `signoffs` table, `POST /api/runs/{id}/signoff`, panel on run page               |
| FR-27 | Block Approve on Not Ready unless override         | P2  | **Missing**              | Enforced in the signoff endpoint (cheap once FR-26 exists)                       |
| NFR   | Staging allow-list for registered URLs             | —   | **Missing**              | `validate_staging_url` in `store.py` (the comment claims it exists; it does not) |
| NFR   | Only approved people can log in                    | —   | **Missing**              | Any Google account can sign in today. `ALLOWED_EMAIL_DOMAINS` in `auth.py`       |
| NFR   | Evidence deleted after 14 days                     | —   | **Missing**              | Optional pg_cron line in migration 0002; artifact retention 14 days in workflow  |
| Bug   | API leaks `api_key_hash` on `GET /api/projects`    | —   | Fix                      | Strip it in the router                                                           |

Order of work for the two remaining days is in Part 5.

---

## Part 1 — Backend (FastAPI, `app/`)

### 1.1 Migration `supabase/migrations/0002_signoffs_owner.sql`

Run it in the Supabase SQL editor after 0001. Adds the owner column
(FR-20) and the sign-off table (FR-26). RLS with no policies again: only the
service role (the backend) can touch it.

```sql
-- Auto Tester — 0002: test owners (FR-20) and release sign-off (FR-26/27)

alter table public.test_results add column if not exists owner text;

create table if not exists public.signoffs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id) on delete cascade,
  decision text not null check (decision in ('approve', 'block')),
  comment text,
  override_reason text, -- the API requires this when approving a Not Ready run (FR-27)
  decided_by_email text not null,
  decided_by_id text,
  created_at timestamptz not null default now()
);

create index if not exists signoffs_run_idx on public.signoffs (run_id, created_at desc);

alter table public.signoffs enable row level security;

-- Optional — NFR "delete evidence after 14 days".
-- Database -> Extensions -> enable pg_cron, then run this once:
-- select cron.schedule('evidence-retention', '30 3 * * *',
--   $$delete from storage.objects
--     where bucket_id = 'evidence' and created_at < now() - interval '14 days'$$);
```

### 1.2 `app/config.py` (full file)

New settings: dashboard URL for alert links, staging allow-list, login
allow-list, alert webhook, GitHub re-run token, manifest path.

```python
"""Application configuration loaded from environment variables and an optional .env file."""
import os
from functools import lru_cache
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent


def load_dotenv(path: Path | None = None) -> None:
    """Minimal .env loader (no extra dependency). Existing env vars win."""
    path = path or ROOT_DIR / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip("'\"")
        if key and key not in os.environ:
            os.environ[key] = value


def _csv(name: str, default: str = "") -> list[str]:
    """Comma-separated env var -> lower-cased list without blanks."""
    return [item.strip().lower() for item in os.getenv(name, default).split(",") if item.strip()]


class Settings:
    def __init__(self) -> None:
        load_dotenv()
        self.supabase_url: str = os.getenv("SUPABASE_URL", "").rstrip("/")
        self.supabase_service_role_key: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        # Optional: lets FastAPI verify JWTs locally (HS256) instead of a network call.
        self.supabase_jwt_secret: str = os.getenv("SUPABASE_JWT_SECRET", "")
        self.cors_origins: list[str] = [
            o.strip()
            for o in os.getenv("AUTOTESTER_CORS_ORIGINS", "http://localhost:3000").split(",")
            if o.strip()
        ]
        # Where failure screenshots are kept when Supabase is not configured (dev mode).
        self.evidence_dir: Path = Path(os.getenv("EVIDENCE_DIR", str(ROOT_DIR / "evidence")))
        # Simple in-memory rate limit for the results endpoint (requests per minute per key).
        self.results_rate_limit: int = int(os.getenv("RESULTS_RATE_LIMIT_PER_MIN", "30"))
        # Max decoded screenshot size accepted on the results endpoint (bytes).
        self.max_screenshot_bytes: int = int(os.getenv("MAX_SCREENSHOT_BYTES", str(2 * 1024 * 1024)))

        # Public URL of the dashboard; used for links in alerts (FR-24).
        self.dashboard_url: str = os.getenv("DASHBOARD_URL", "http://localhost:3000").rstrip("/")
        # NFR Safety: hosts a project's staging_url may point at. Empty = no check (local dev).
        self.staging_allowlist: list[str] = _csv("STAGING_ALLOWLIST")
        # Who may log in. Both empty = any authenticated account (local dev only!).
        self.allowed_emails: list[str] = _csv("ALLOWED_EMAILS")
        self.allowed_email_domains: list[str] = _csv("ALLOWED_EMAIL_DOMAINS")
        # FR-24: outbound webhook for failure alerts.
        self.alert_webhook_url: str = os.getenv("ALERT_WEBHOOK_URL", "")
        self.alert_on_success: bool = os.getenv("ALERT_ON_SUCCESS", "false").lower() in ("1", "true", "yes")
        # FR-14: re-run through GitHub's workflow_dispatch API.
        self.github_token: str = os.getenv("GITHUB_TOKEN", "")
        self.runner_repo: str = os.getenv("RUNNER_REPO", "")  # "owner/repo" of the repo holding smoke.yml
        self.runner_ref: str = os.getenv("RUNNER_REF", "main")
        self.workflow_file: str = os.getenv("RUNNER_WORKFLOW_FILE", "smoke.yml")
        # FR-22: the manifest the Tests page reads.
        self.manifest_path: Path = Path(os.getenv("TEST_MANIFEST", str(ROOT_DIR / "e2e" / "manifest.json")))

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

### 1.3 `app/models.py` (full file)

Adds `owner` on a test, `RunUpdate` for finishing a Running run, and
`SignoffIn`.

```python
"""Pydantic models for the results API and dashboard reads."""
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

TestPriority = Literal["P0", "P1", "P2"]
TestStatus = Literal["passed", "failed", "flaky", "skipped", "error"]
Verdict = Literal["running", "ready", "ready_with_warnings", "not_ready", "error"]


class TestResultIn(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    feature: Optional[str] = Field(default=None, max_length=100)
    priority: TestPriority = "P0"
    status: TestStatus
    duration_ms: Optional[int] = Field(default=None, ge=0)
    error: Optional[str] = Field(default=None, max_length=20000)
    # FR-20: who looks after this test when it is flaky or failing.
    owner: Optional[str] = Field(default=None, max_length=120)
    # Failure evidence; raw base64 or a data: URL. Stored privately, never inline in the DB.
    screenshot_base64: Optional[str] = None


def _limit_screenshots(tests: list[TestResultIn]) -> list[TestResultIn]:
    if sum(1 for t in tests if t.screenshot_base64) > 25:
        raise ValueError("at most 25 screenshots per run")
    return tests


class RunIn(BaseModel):
    """POST /api/runs. status='running' registers a run the runner will finish later."""

    branch: str = Field(default="main", max_length=200)
    commit: Optional[str] = Field(default=None, max_length=64)
    commit_message: Optional[str] = Field(default=None, max_length=500)
    trigger: Literal["manual", "push", "pull_request", "nightly", "re-run"] = "manual"
    environment: Literal["staging"] = "staging"
    status: Literal["running", "completed", "error"] = "completed"
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    tests: list[TestResultIn] = Field(default_factory=list, max_length=500)

    @field_validator("tests")
    @classmethod
    def limit_screenshots(cls, tests: list[TestResultIn]) -> list[TestResultIn]:
        return _limit_screenshots(tests)


class RunUpdate(BaseModel):
    """PATCH /api/runs/{id}: the runner finishes a run it registered as 'running'."""

    status: Literal["completed", "error"] = "completed"
    finished_at: Optional[datetime] = None
    tests: list[TestResultIn] = Field(default_factory=list, max_length=500)

    @field_validator("tests")
    @classmethod
    def limit_screenshots(cls, tests: list[TestResultIn]) -> list[TestResultIn]:
        return _limit_screenshots(tests)


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    repo_url: Optional[str] = Field(default=None, max_length=300)
    branch: str = Field(default="main", max_length=200)
    staging_url: Optional[str] = Field(default=None, max_length=300)
    alert_channel: Optional[str] = Field(default=None, max_length=120)

    @field_validator("staging_url")
    @classmethod
    def https_only(cls, v: Optional[str]) -> Optional[str]:
        # FR-25: must start with https://. The host allow-list check lives in store.validate_staging_url.
        if v and not v.startswith("https://"):
            raise ValueError("staging_url must start with https://")
        return v


class SignoffIn(BaseModel):
    """POST /api/runs/{id}/signoff (FR-26)."""

    decision: Literal["approve", "block"]
    comment: Optional[str] = Field(default=None, max_length=2000)
    override_reason: Optional[str] = Field(default=None, max_length=500)
```

### 1.4 `app/auth.py` (full file)

Same as before plus the allow-list. With both lists empty (local dev) every
authenticated account passes, so set `ALLOWED_EMAIL_DOMAINS` in production.

```python
"""Supabase Auth verification for dashboard API calls (PRD FR-16).

The frontend sends the user's Supabase access token as a bearer token.
Two verification paths:
  * SUPABASE_JWT_SECRET set  -> local HS256 verification with PyJWT (no network call)
  * otherwise                -> supabase.auth.get_user(token) (network call)
When Supabase is not configured (dev mode) auth is skipped so the app can be
demoed locally before a Supabase project exists.

After verification the email is checked against ALLOWED_EMAILS /
ALLOWED_EMAIL_DOMAINS so that not every Google account on earth can read the
team's release verdicts.
"""
import logging
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import get_settings

logger = logging.getLogger("autotester.auth")
bearer = HTTPBearer(auto_error=False)


def _verify_with_secret(token: str) -> Optional[dict]:
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
        return {"sub": payload.get("sub"), "email": payload.get("email")}
    except jwt.PyJWTError as exc:
        logger.info("jwt rejected: %s", exc)
        return None


def _verify_with_supabase(token: str) -> Optional[dict]:
    from supabase import create_client

    settings = get_settings()
    try:
        client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        user = client.auth.get_user(token).user
        return {"sub": user.id, "email": getattr(user, "email", None)}
    except Exception as exc:
        logger.info("supabase token rejected: %s", exc)
        return None


def _email_allowed(email: Optional[str]) -> bool:
    settings = get_settings()
    if not settings.allowed_emails and not settings.allowed_email_domains:
        return True
    email = (email or "").lower()
    if email in settings.allowed_emails:
        return True
    domain = email.rsplit("@", 1)[-1] if "@" in email else ""
    return domain in settings.allowed_email_domains


async def require_user(
    request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)
) -> dict:
    """Dependency for dashboard endpoints. Returns the authenticated user."""
    settings = get_settings()
    if not settings.supabase_configured:
        # Dev mode: no Supabase project yet, keep local flow open.
        request.state.user = {"sub": "dev", "email": "dev@localhost"}
        return request.state.user
    token = credentials.credentials if credentials else request.headers.get("x-autotester-token", "")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = None
    if settings.supabase_jwt_secret:
        user = _verify_with_secret(token)
    if user is None:
        user = _verify_with_supabase(token)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if not _email_allowed(user.get("email")):
        logger.info("login refused for %s", user.get("email"))
        raise HTTPException(status_code=403, detail="This account is not allowed to use Auto Tester")
    request.state.user = user
    return user
```

### 1.5 `app/alerts.py` (new, FR-24)

One JSON POST to `ALERT_WEBHOOK_URL` on a Not Ready verdict (and on
success if `ALERT_ON_SUCCESS=true`). The payload has a plain `text` field,
which Slack- and Mattermost-style incoming webhooks accept as-is, plus
structured fields for a Zedu bot. Which channel and which format Zedu wants
is PRD open question 5: confirm with the leads, then adjust `build_payload`
only. Sending runs on a background thread so the runner never waits and a
dead webhook never fails a run.

```python
"""FR-24: tell the team when a run fails. Outbound webhook only."""
import json
import logging
import threading
import urllib.error
import urllib.request

from .config import get_settings

logger = logging.getLogger("autotester.alerts")

LABELS = {
    "ready": "Ready",
    "ready_with_warnings": "Ready with warnings",
    "not_ready": "Not Ready",
    "error": "Error",
    "running": "Running",
}


def _should_alert(verdict: str) -> bool:
    settings = get_settings()
    if not settings.alert_webhook_url:
        return False
    if verdict in ("not_ready", "error"):
        return True
    return settings.alert_on_success and verdict in ("ready", "ready_with_warnings")


def build_payload(project: dict, run: dict, failed_names: list[str]) -> dict:
    link = f"{get_settings().dashboard_url}/runs/{run['id']}"
    commit = (run.get("commit_sha") or "")[:8] or "unknown"
    lines = [
        f"Auto Tester: {LABELS.get(run['verdict'], run['verdict'])} — "
        f"{project['name']} ({run['branch']} @ {commit})",
        f"{run['passed']} passed · {run['failed']} failed · {run['flaky']} flaky · {run['total']} total",
    ]
    if failed_names:
        more = f" (+{len(failed_names) - 10} more)" if len(failed_names) > 10 else ""
        lines.append("Failed: " + ", ".join(failed_names[:10]) + more)
    lines.append(link)
    return {
        "channel": project.get("alert_channel"),
        "text": "\n".join(lines),
        "project": project["name"],
        "branch": run["branch"],
        "commit": run.get("commit_sha"),
        "verdict": run["verdict"],
        "failed_tests": failed_names,
        "run_url": link,
    }


def _send(payload: dict) -> None:
    request = urllib.request.Request(
        get_settings().alert_webhook_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "auto-tester"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            logger.info("alert sent (HTTP %s) for %s", response.status, payload["run_url"])
    except (urllib.error.URLError, OSError) as exc:
        logger.error("alert failed: %s", exc)


def notify_run_finished(project: dict, run: dict, tests: list[dict]) -> None:
    """Call once a run has a final verdict. Never raises, never blocks."""
    if not _should_alert(run["verdict"]):
        return
    failed = [t["name"] for t in tests if t["status"] in ("failed", "error")]
    threading.Thread(target=_send, args=(build_payload(project, run, failed),), daemon=True).start()
```

### 1.6 `app/github.py` (new, FR-14)

The Re-run button asks GitHub to start the smoke workflow again. The token
is a fine-grained personal access token with **Actions: read and write** on
the runner repo only, stored as `GITHUB_TOKEN` on the API (Coolify), never
in the frontend. `RUNNER_REPO=zedu-yodaa/auto-tester` points at the repo
that holds `smoke.yml`; without it the project's `repo_url` is used (FR-13
case, once the workflow is copied into Zedu's repo).

```python
"""FR-14: "Re-run" — start the smoke workflow again via GitHub workflow_dispatch."""
import json
import re
import urllib.error
import urllib.request
from typing import Optional

from .config import get_settings

_REPO_RE = re.compile(r"github\.com[/:]([\w.-]+)/([\w.-]+?)(?:\.git)?/?$")


def parse_repo(repo_url: Optional[str]) -> Optional[str]:
    """'https://github.com/zedu-yodaa/zedu' -> 'zedu-yodaa/zedu'."""
    match = _REPO_RE.search((repo_url or "").strip())
    return f"{match.group(1)}/{match.group(2)}" if match else None


def dispatch_rerun(project: dict, run: dict) -> None:
    settings = get_settings()
    if not settings.github_token:
        raise RuntimeError("Re-run is not configured: set GITHUB_TOKEN on the API")
    if settings.runner_repo:
        repo, ref = settings.runner_repo, settings.runner_ref
    else:
        repo, ref = parse_repo(project.get("repo_url")), run["branch"]
    if not repo:
        raise RuntimeError("Project has no GitHub repo_url and RUNNER_REPO is not set")

    url = f"https://api.github.com/repos/{repo}/actions/workflows/{settings.workflow_file}/dispatches"
    body = json.dumps(
        {"ref": ref, "inputs": {"environment": "staging", "tag": "", "trigger": "re-run"}}
    ).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {settings.github_token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "auto-tester",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status not in (200, 204):
                raise RuntimeError(f"GitHub returned HTTP {response.status}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"GitHub rejected the re-run ({exc.code}): {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Could not reach GitHub: {exc.reason}") from exc
```

### 1.7 `app/store.py` (full file)

What changed: shared row builders so both stores agree; `update_run` for
the Running flow; `get_project`; sign-offs; `latest_results` for the Tests
page; the staging allow-list check; and dev-mode screenshot URLs now go
through the Next.js proxy (`/api/backend/evidence/...`) so they render.

```python
"""Data access: Supabase when configured, in-memory fallback for local dev.

Both stores return plain dicts with the same shape so the API layer does not
care which one is active. Screenshots are stored privately: Supabase Storage
(short-lived signed URLs) or local files served by the dev server.
"""
import base64
import binascii
import hashlib
import logging
import re
import secrets
import threading
import uuid
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

from .config import get_settings
from .models import RunIn, RunUpdate, SignoffIn, TestResultIn
from .verdict import compute_verdict, summarise

logger = logging.getLogger("autotester.store")

API_KEY_PREFIX = "at_"
EVIDENCE_BUCKET = "evidence"


# -- small helpers ----------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _slug(text: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", text).strip("-").lower()[:80] or "test"


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _duration_ms(started: Optional[datetime], finished: Optional[datetime]) -> Optional[int]:
    if not started or not finished:
        return None
    try:
        return int((finished - started).total_seconds() * 1000)
    except TypeError:  # one aware, one naive datetime
        return None


def validate_staging_url(url: Optional[str]) -> None:
    """NFR Safety: a project's staging_url must point at an allow-listed host.
    An empty STAGING_ALLOWLIST (local dev) disables the check."""
    if not url:
        return
    allowed = get_settings().staging_allowlist
    if not allowed:
        return
    host = (urlparse(url).hostname or "").lower()
    if not any(host == a or host.endswith("." + a) for a in allowed):
        raise ValueError(f"staging_url host '{host}' is not in the staging allow-list")


def decode_screenshot(data: str) -> tuple[bytes, str]:
    """Decode a base64 (or data: URL) screenshot. Returns (bytes, content_type)."""
    if "," in data and data.strip().startswith("data:"):
        header, _, data = data.partition(",")
        content_type = header[5:].split(";")[0] or "image/png"
    else:
        content_type = "image/png"
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("screenshot_base64 is not valid base64") from exc
    if not raw:
        raise ValueError("screenshot_base64 is empty")
    if raw[:8].startswith(b"\x89PNG"):
        content_type = "image/png"
    elif raw[:3] == b"\xff\xd8\xff":
        content_type = "image/jpeg"
    elif raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        content_type = "image/webp"
    max_bytes = get_settings().max_screenshot_bytes
    if len(raw) > max_bytes:
        raise ValueError(f"screenshot exceeds {max_bytes} bytes")
    return raw, content_type


def _evidence_name(run_id: str, test_name: str, content_type: str) -> str:
    ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}.get(content_type, "png")
    return f"{run_id}/{_slug(test_name)}.{ext}"


def _attach_last_run(projects: list[dict], runs: list[dict]) -> list[dict]:
    """Add last_run (id, verdict, created_at) to each project card."""
    latest: dict[str, dict] = {}
    for run in sorted(runs, key=lambda r: r["created_at"] or "", reverse=True):
        latest.setdefault(
            run["project_id"],
            {"id": run["id"], "verdict": run["verdict"], "created_at": run["created_at"]},
        )
    for project in projects:
        project["last_run"] = latest.get(project["id"])
    return projects


def _test_dict(run_id: str, t: TestResultIn, screenshot_path: Optional[str]) -> dict:
    """One test_results row (stores add id/created_at where needed)."""
    return {
        "run_id": run_id,
        "name": t.name,
        "feature": t.feature,
        "priority": t.priority,
        "status": t.status,
        "duration_ms": t.duration_ms,
        "error": t.error,
        "owner": t.owner,
        "screenshot_path": screenshot_path,
    }


def _run_dict(project_id: str, data: RunIn, tests: list[dict]) -> dict:
    """A new runs row. With status='running' and no tests the verdict is 'running'."""
    return {
        "project_id": project_id,
        "branch": data.branch,
        "commit_sha": data.commit,
        "commit_message": data.commit_message,
        "trigger": data.trigger,
        "environment": data.environment,
        "status": data.status,
        "verdict": compute_verdict(data.status, tests),
        **summarise(tests),
        "duration_ms": _duration_ms(data.started_at, data.finished_at),
        "started_at": _iso(data.started_at) or _now(),
        "finished_at": _iso(data.finished_at),
    }


def _finish_patch(run: dict, data: RunUpdate, tests: list[dict]) -> dict:
    """Fields that change when a 'running' run is finished."""
    finished = data.finished_at or datetime.now(timezone.utc)
    return {
        "status": data.status,
        "verdict": compute_verdict(data.status, tests),
        **summarise(tests),
        "finished_at": finished.isoformat(),
        "duration_ms": _duration_ms(_parse_iso(run.get("started_at")), finished),
    }


def _signoff_dict(run_id: str, user: dict, data: SignoffIn) -> dict:
    return {
        "run_id": run_id,
        "decision": data.decision,
        "comment": data.comment,
        "override_reason": data.override_reason,
        "decided_by_email": user.get("email") or "unknown",
        "decided_by_id": user.get("sub"),
    }


# -- in-memory store (dev mode) -----------------------------------------------

class MemoryStore:
    """Process-local store used when Supabase is not configured (dev mode)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._projects: dict[str, dict] = {}
        self._runs: dict[str, dict] = {}
        self._tests: dict[str, list[dict]] = {}
        self._signoffs: dict[str, list[dict]] = {}
        self._key_hashes: dict[str, str] = {}  # sha256 -> project_id

    # projects
    def create_project(self, data: dict) -> tuple[dict, str]:
        raw_key = API_KEY_PREFIX + secrets.token_urlsafe(32)
        project = {
            "id": str(uuid.uuid4()),
            "name": data["name"],
            "repo_url": data.get("repo_url"),
            "branch": data.get("branch", "main"),
            "staging_url": data.get("staging_url"),
            "alert_channel": data.get("alert_channel"),
            "api_key_hash": _sha256(raw_key),
            "created_at": _now(),
        }
        with self._lock:
            self._projects[project["id"]] = project
            self._key_hashes[project["api_key_hash"]] = project["id"]
        return dict(project), raw_key

    def list_projects(self) -> list[dict]:
        with self._lock:
            projects = [dict(p) for p in self._projects.values()]
            runs = [dict(r) for r in self._runs.values()]
        return _attach_last_run(projects, runs)

    def get_project(self, project_id: str) -> Optional[dict]:
        with self._lock:
            project = self._projects.get(project_id)
            return dict(project) if project else None

    def get_project_by_api_key(self, raw_key: str) -> Optional[dict]:
        project_id = self._key_hashes.get(_sha256(raw_key))
        with self._lock:
            project = self._projects.get(project_id)
            return dict(project) if project else None

    # runs
    def _build_tests(self, run_id: str, tests: list[TestResultIn]) -> list[dict]:
        rows = []
        for t in tests:
            path = self._save_evidence(run_id, t.name, t.screenshot_base64) if t.screenshot_base64 else None
            rows.append({"id": str(uuid.uuid4()), **_test_dict(run_id, t, path), "created_at": _now()})
        return rows

    def create_run(self, project_id: str, data: RunIn) -> dict:
        run_id = str(uuid.uuid4())
        tests = self._build_tests(run_id, data.tests)
        run = {"id": run_id, **_run_dict(project_id, data, tests), "created_at": _now()}
        with self._lock:
            self._runs[run_id] = run
            self._tests[run_id] = tests
        return dict(run)

    def update_run(self, run_id: str, project_id: str, data: RunUpdate) -> Optional[dict]:
        with self._lock:
            run = self._runs.get(run_id)
            if not run or run["project_id"] != project_id:
                return None
        tests = self._build_tests(run_id, data.tests)
        updated = {**run, **_finish_patch(run, data, tests)}
        with self._lock:
            self._runs[run_id] = updated
            self._tests[run_id] = tests
        return dict(updated)

    def list_runs(self, project_id: Optional[str] = None) -> list[dict]:
        with self._lock:
            runs = [dict(r) for r in self._runs.values()]
        runs.sort(key=lambda r: r["created_at"] or "", reverse=True)
        if project_id:
            runs = [r for r in runs if r["project_id"] == project_id]
        return runs

    def get_run(self, run_id: str) -> Optional[dict]:
        with self._lock:
            run = self._runs.get(run_id)
            if not run:
                return None
            return {
                **dict(run),
                "tests": [dict(t) for t in self._tests.get(run_id, [])],
                "signoffs": [dict(s) for s in self._signoffs.get(run_id, [])],
            }

    # sign-off (FR-26)
    def add_signoff(self, run_id: str, user: dict, data: SignoffIn) -> Optional[dict]:
        row = {"id": str(uuid.uuid4()), **_signoff_dict(run_id, user, data), "created_at": _now()}
        with self._lock:
            if run_id not in self._runs:
                return None
            self._signoffs.setdefault(run_id, []).insert(0, row)
        return dict(row)

    # tests page (FR-22)
    def latest_results(self) -> dict[str, dict]:
        """Most recent result per test name."""
        with self._lock:
            runs = sorted(self._runs.values(), key=lambda r: r["created_at"] or "", reverse=True)
            latest: dict[str, dict] = {}
            for run in runs:
                for t in self._tests.get(run["id"], []):
                    latest.setdefault(t["name"], {**t, "run_created_at": run["created_at"]})
            return latest

    # evidence
    def _save_evidence(self, run_id: str, test_name: str, b64: str) -> Optional[str]:
        try:
            raw, content_type = decode_screenshot(b64)
        except ValueError as exc:
            logger.warning("screenshot rejected for %s: %s", test_name, exc)
            return None
        rel = _evidence_name(run_id, test_name, content_type)
        dest = get_settings().evidence_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(raw)
        return rel

    def get_evidence_file(self, rel_path: str) -> Optional[tuple[bytes, str]]:
        base = get_settings().evidence_dir.resolve()
        dest = (base / rel_path).resolve()
        if not str(dest).startswith(str(base)) or not dest.is_file():
            return None
        content_type = "image/png"
        if dest.suffix == ".jpg":
            content_type = "image/jpeg"
        elif dest.suffix == ".webp":
            content_type = "image/webp"
        return dest.read_bytes(), content_type

    def screenshot_url(self, run_id: str, rel_path: Optional[str]) -> Optional[str]:
        if not rel_path:
            return None
        # Through the Next.js proxy so the browser can load it on :3000.
        return f"/api/backend/evidence/{rel_path}"


# -- Supabase store -----------------------------------------------------------

class SupabaseStore:
    """Stores runs/projects in Supabase (tables + private Storage bucket)."""

    def __init__(self) -> None:
        from supabase import create_client

        settings = get_settings()
        self.client = create_client(settings.supabase_url, settings.supabase_service_role_key)

    # projects
    def create_project(self, data: dict) -> tuple[dict, str]:
        raw_key = API_KEY_PREFIX + secrets.token_urlsafe(32)
        row = {
            "id": str(uuid.uuid4()),
            "name": data["name"],
            "repo_url": data.get("repo_url"),
            "branch": data.get("branch", "main"),
            "staging_url": data.get("staging_url"),
            "alert_channel": data.get("alert_channel"),
            "api_key_hash": _sha256(raw_key),
        }
        resp = self.client.table("projects").insert(row).execute()
        return resp.data[0], raw_key

    def list_projects(self) -> list[dict]:
        projects = self.client.table("projects").select("*").execute().data
        runs = self.client.table("runs").select("*").order("created_at", desc=True).execute().data
        return _attach_last_run(projects, runs)

    def get_project(self, project_id: str) -> Optional[dict]:
        resp = self.client.table("projects").select("*").eq("id", project_id).limit(1).execute()
        return resp.data[0] if resp.data else None

    def get_project_by_api_key(self, raw_key: str) -> Optional[dict]:
        resp = (
            self.client.table("projects")
            .select("*")
            .eq("api_key_hash", _sha256(raw_key))
            .limit(1)
            .execute()
        )
        return resp.data[0] if resp.data else None

    # runs
    def _build_tests(self, run_id: str, tests: list[TestResultIn]) -> list[dict]:
        rows = []
        for t in tests:
            path = self._save_evidence(run_id, t.name, t.screenshot_base64) if t.screenshot_base64 else None
            rows.append(_test_dict(run_id, t, path))
        return rows

    def create_run(self, project_id: str, data: RunIn) -> dict:
        plain = [t.model_dump() for t in data.tests]
        run = self.client.table("runs").insert(_run_dict(project_id, data, plain)).execute().data[0]
        rows = self._build_tests(run["id"], data.tests)
        if rows:
            self.client.table("test_results").insert(rows).execute()
        return run

    def update_run(self, run_id: str, project_id: str, data: RunUpdate) -> Optional[dict]:
        resp = (
            self.client.table("runs")
            .select("*")
            .eq("id", run_id)
            .eq("project_id", project_id)
            .limit(1)
            .execute()
        )
        if not resp.data:
            return None
        run = resp.data[0]
        rows = self._build_tests(run_id, data.tests)
        if rows:
            self.client.table("test_results").insert(rows).execute()
        plain = [t.model_dump() for t in data.tests]
        patch = _finish_patch(run, data, plain)
        return self.client.table("runs").update(patch).eq("id", run_id).execute().data[0]

    def list_runs(self, project_id: Optional[str] = None) -> list[dict]:
        query = self.client.table("runs").select("*").order("created_at", desc=True)
        if project_id:
            query = query.eq("project_id", project_id)
        return query.execute().data

    def get_run(self, run_id: str) -> Optional[dict]:
        run_resp = self.client.table("runs").select("*").eq("id", run_id).limit(1).execute()
        if not run_resp.data:
            return None
        tests = (
            self.client.table("test_results")
            .select("*")
            .eq("run_id", run_id)
            .order("created_at")
            .execute()
            .data
        )
        signoffs = (
            self.client.table("signoffs")
            .select("*")
            .eq("run_id", run_id)
            .order("created_at", desc=True)
            .execute()
            .data
        )
        return {**run_resp.data[0], "tests": tests, "signoffs": signoffs}

    # sign-off (FR-26)
    def add_signoff(self, run_id: str, user: dict, data: SignoffIn) -> Optional[dict]:
        exists = self.client.table("runs").select("id").eq("id", run_id).limit(1).execute().data
        if not exists:
            return None
        return self.client.table("signoffs").insert(_signoff_dict(run_id, user, data)).execute().data[0]

    # tests page (FR-22)
    def latest_results(self) -> dict[str, dict]:
        rows = (
            self.client.table("test_results")
            .select("name,feature,priority,status,owner,run_id,created_at")
            .order("created_at", desc=True)
            .limit(2000)
            .execute()
            .data
        )
        latest: dict[str, dict] = {}
        for row in rows:
            latest.setdefault(row["name"], {**row, "run_created_at": row["created_at"]})
        return latest

    # evidence
    def _save_evidence(self, run_id: str, test_name: str, b64: str) -> Optional[str]:
        try:
            raw, content_type = decode_screenshot(b64)
        except ValueError as exc:
            logger.warning("screenshot rejected for %s: %s", test_name, exc)
            return None
        path = _evidence_name(run_id, test_name, content_type)
        try:
            self.client.storage.from_(EVIDENCE_BUCKET).upload(
                path, raw, {"content-type": content_type, "x-upsert": "true"}
            )
        except Exception as exc:  # evidence must never fail the run ingest
            logger.error("screenshot upload failed: %s", exc)
            return None
        return path

    def screenshot_url(self, run_id: str, rel_path: Optional[str]) -> Optional[str]:
        if not rel_path:
            return None
        try:
            resp = self.client.storage.from_(EVIDENCE_BUCKET).create_signed_url(rel_path, 3600)
            if isinstance(resp, dict):
                return resp.get("signedURL") or resp.get("signed_url")
            return resp.signedURL
        except Exception as exc:
            logger.error("signed url failed: %s", exc)
            return None


_store = None
_store_lock = threading.Lock()


def get_store():
    """Singleton: Supabase if configured, otherwise the in-memory dev store."""
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                if get_settings().supabase_configured:
                    _store = SupabaseStore()
                    logger.info("store: Supabase (%s)", get_settings().supabase_url)
                else:
                    _store = MemoryStore()
                    logger.warning("store: in-memory dev mode (SUPABASE_URL not set)")
    return _store
```

### 1.8 `app/routers/results.py` (full file)

New endpoints: `PATCH /api/runs/{id}` (finish a Running run),
`POST /api/runs/{id}/signoff`, `POST /api/runs/{id}/rerun`, `GET /api/tests`.
Alerts fire whenever a run reaches a final verdict. The project hash is no
longer returned.

```python
"""Results API — what the GitHub Actions runner posts to (PRD FR-15, FR-25).

POST  /api/projects              create a project (login), returns its API key once
GET   /api/projects              project cards (login)
POST  /api/runs                  register or ingest a run (X-API-Key)
PATCH /api/runs/{id}             finish a run registered as 'running' (X-API-Key)
GET   /api/runs, /api/runs/{id}  dashboard reads (login)
POST  /api/runs/{id}/signoff     FR-26/27 release sign-off (login)
POST  /api/runs/{id}/rerun       FR-14 start the workflow again (login)
GET   /api/tests                 FR-22 manifest + last result per test (login)
GET   /api/evidence/{path}       dev-mode screenshot serving (Supabase mode uses signed URLs)
"""
import json
import logging
import threading
import time

from fastapi import APIRouter, Depends, Header, HTTPException, Response

from ..alerts import notify_run_finished
from ..auth import require_user
from ..config import get_settings
from ..github import dispatch_rerun
from ..models import ProjectCreate, RunIn, RunUpdate, SignoffIn
from ..store import MemoryStore, get_store, validate_staging_url

logger = logging.getLogger("autotester.api")
router = APIRouter(prefix="/api")


class RateLimiter:
    """Fixed-window per-key limiter so the results endpoint cannot be spammed."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hits: dict[str, list[float]] = {}

    def check(self, key: str) -> None:
        limit = get_settings().results_rate_limit
        now = time.monotonic()
        with self._lock:
            hits = [t for t in self._hits.get(key, []) if now - t < 60]
            if len(hits) >= limit:
                raise HTTPException(status_code=429, detail="Rate limit exceeded, retry later")
            hits.append(now)
            self._hits[key] = hits


limiter = RateLimiter()


def _public(project: dict) -> dict:
    """Never return the key hash to the dashboard."""
    return {k: v for k, v in project.items() if k != "api_key_hash"}


def _project_for_key(x_api_key: str) -> dict:
    if not x_api_key:
        raise HTTPException(status_code=401, detail="X-API-Key header is required")
    limiter.check(x_api_key)
    project = get_store().get_project_by_api_key(x_api_key)
    if not project:
        raise HTTPException(status_code=403, detail="Unknown project API key")
    return project


def _tests_of(run_id: str) -> list[dict]:
    full = get_store().get_run(run_id)
    return full["tests"] if full else []


# -- projects -----------------------------------------------------------------

@router.post("/projects", status_code=201)
def create_project(data: ProjectCreate, _user: dict = Depends(require_user)):
    try:
        validate_staging_url(data.staging_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    project, raw_key = get_store().create_project(data.model_dump())
    # The raw key is shown once; only its hash is stored (NFR security).
    return {**_public(project), "api_key": raw_key}


@router.get("/projects")
def list_projects(_user: dict = Depends(require_user)):
    return [_public(p) for p in get_store().list_projects()]


# -- runs: runner side (API key) ----------------------------------------------

@router.post("/runs", status_code=201)
def ingest_run(data: RunIn, x_api_key: str = Header(default="")):
    project = _project_for_key(x_api_key)
    if data.environment != "staging":
        raise HTTPException(status_code=400, detail="Only the staging environment is allowed")
    run = get_store().create_run(project["id"], data)
    logger.info("run %s %s for project %s -> %s", run["id"], run["status"], project["name"], run["verdict"])
    if run["status"] != "running":
        notify_run_finished(project, run, _tests_of(run["id"]))
    return run


@router.patch("/runs/{run_id}")
def finish_run(run_id: str, data: RunUpdate, x_api_key: str = Header(default="")):
    """Finish a run that was registered with status='running' (FR-17 Running)."""
    project = _project_for_key(x_api_key)
    run = get_store().update_run(run_id, project["id"], data)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found for this project")
    logger.info("run %s finished for project %s -> %s", run_id, project["name"], run["verdict"])
    notify_run_finished(project, run, _tests_of(run_id))
    return run


# -- runs: dashboard side (login) ---------------------------------------------

@router.get("/runs")
def list_runs(project_id: str | None = None, _user: dict = Depends(require_user)):
    return get_store().list_runs(project_id)


@router.get("/runs/{run_id}")
def get_run(run_id: str, _user: dict = Depends(require_user)):
    store = get_store()
    run = store.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    # Attach screenshot URLs (signed in Supabase mode, proxied local path in dev mode).
    for test in run["tests"]:
        test["screenshot_url"] = store.screenshot_url(run_id, test.get("screenshot_path"))
    return run


@router.post("/runs/{run_id}/signoff", status_code=201)
def sign_off(run_id: str, data: SignoffIn, user: dict = Depends(require_user)):
    """FR-26: a named person records Approve or Block. FR-27: Approve on a
    Not Ready run needs an override reason."""
    store = get_store()
    run = store.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run["verdict"] == "running":
        raise HTTPException(status_code=400, detail="Wait for the run to finish before signing off")
    if (
        data.decision == "approve"
        and run["verdict"] in ("not_ready", "error")
        and not (data.override_reason or "").strip()
    ):
        raise HTTPException(
            status_code=400,
            detail="This run is Not Ready: enter an override reason to approve it anyway",
        )
    row = store.add_signoff(run_id, user, data)
    if not row:
        raise HTTPException(status_code=404, detail="Run not found")
    logger.info("run %s %s by %s", run_id, data.decision, user.get("email"))
    return row


@router.post("/runs/{run_id}/rerun", status_code=202)
def rerun(run_id: str, user: dict = Depends(require_user)):
    """FR-14: ask GitHub to run the smoke workflow again."""
    store = get_store()
    run = store.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    project = store.get_project(run["project_id"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        dispatch_rerun(project, run)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    logger.info("re-run of %s requested by %s", run_id, user.get("email"))
    return {"status": "requested"}


# -- tests page (FR-22) ------------------------------------------------------

def _load_manifest() -> list[dict]:
    path = get_settings().manifest_path
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        logger.warning("manifest %s is not valid JSON", path)
        return []
    tests = data.get("tests", []) if isinstance(data, dict) else data
    return [t for t in tests if isinstance(t, dict) and t.get("name")]


@router.get("/tests")
def list_tests(_user: dict = Depends(require_user)):
    """The manifest merged with each test's most recent result."""
    latest = get_store().latest_results()
    items: list[dict] = []
    seen: set[str] = set()
    for entry in _load_manifest():
        last = latest.get(entry["name"])
        seen.add(entry["name"])
        items.append(
            {
                "name": entry["name"],
                "feature": entry.get("feature"),
                "priority": entry.get("priority", "P0"),
                "owner": entry.get("owner"),
                "enabled": bool(entry.get("enabled", True)),
                "last_status": last["status"] if last else None,
                "last_run_id": last["run_id"] if last else None,
                "last_run_at": last["run_created_at"] if last else None,
            }
        )
    # Tests that reported results but are not in the manifest (yet).
    for name, last in latest.items():
        if name in seen:
            continue
        items.append(
            {
                "name": name,
                "feature": last.get("feature"),
                "priority": last.get("priority", "P0"),
                "owner": last.get("owner"),
                "enabled": None,
                "last_status": last["status"],
                "last_run_id": last["run_id"],
                "last_run_at": last["run_created_at"],
            }
        )
    return items


# -- evidence (dev mode) -----------------------------------------------------

@router.get("/evidence/{run_id}/{file_path:path}")
def serve_evidence(run_id: str, file_path: str):
    if get_settings().supabase_configured:
        raise HTTPException(status_code=404, detail="Evidence is served by Supabase signed URLs")
    store = get_store()
    if not isinstance(store, MemoryStore):
        raise HTTPException(status_code=404, detail="Not found")
    result = store.get_evidence_file(f"{run_id}/{file_path}")
    if not result:
        raise HTTPException(status_code=404, detail="Not found")
    data, content_type = result
    return Response(content=data, media_type=content_type, headers={"Cache-Control": "private, max-age=300"})
```

`app/main.py` and `app/verdict.py` need no changes.

### 1.9 Env files

Append to `.env.example` (and to your real `.env` / Coolify):

```bash
# Public dashboard URL, used for links in alerts
DASHBOARD_URL=http://localhost:3000
# NFR Safety: hosts a project's staging URL may use. Leave empty locally.
STAGING_ALLOWLIST=staging.zedu.chat
# Who may log in. Leave both empty locally; set at least one in production.
ALLOWED_EMAIL_DOMAINS=
ALLOWED_EMAILS=
# FR-24 alerts: incoming-webhook URL of the Zedu channel (or Slack-compatible). Empty = off.
ALERT_WEBHOOK_URL=
ALERT_ON_SUCCESS=false
# FR-14 re-run: fine-grained PAT with Actions: write on the runner repo
GITHUB_TOKEN=
RUNNER_REPO=zedu-yodaa/auto-tester
RUNNER_REF=main
RUNNER_WORKFLOW_FILE=smoke.yml
```

Append to `.dockerignore` so the API image stays small:

```
frontend/node_modules
frontend/.next
e2e/node_modules
e2e/.auth
e2e/test-results
e2e/report
```

### 1.10 Test the backend with curl (dev mode)

Start the API in dev mode (`SUPABASE_SERVICE_ROLE_KEY= .venv/bin/uvicorn app.main:app --reload`), create a project as before, then:

```bash
KEY=at_...   # from the project response

# 1. Register a run as Running (what the workflow does first)
curl -s -X POST localhost:8000/api/runs -H 'Content-Type: application/json' -H "X-API-Key: $KEY" \
  -d '{"branch":"main","commit":"abc1234","trigger":"manual","status":"running","tests":[]}'
# -> "verdict":"running". Copy the "id".

# 2. Finish it (what post-results.mjs does)
curl -s -X PATCH localhost:8000/api/runs/RUN_ID -H 'Content-Type: application/json' -H "X-API-Key: $KEY" \
  -d '{"status":"completed","tests":[
    {"name":"login shows the sidebar","feature":"auth","priority":"P0","status":"passed","duration_ms":2100,"owner":"auth-squad"},
    {"name":"message sent by user A reaches user B","feature":"messaging","priority":"P0","status":"flaky","duration_ms":9000,"owner":"messaging-squad","error":"first attempt timed out"}]}'
# -> "verdict":"ready_with_warnings"

# 3. Sign off (dev mode needs no token)
curl -s -X POST localhost:8000/api/runs/RUN_ID/signoff -H 'Content-Type: application/json' \
  -d '{"decision":"approve","comment":"flaky test is known"}'

# 4. Tests page data
curl -s localhost:8000/api/tests

# 5. Re-run without GITHUB_TOKEN -> 502 with a clear message (expected)
curl -s -X POST localhost:8000/api/runs/RUN_ID/rerun
```

---

## Part 2 — Frontend (Next.js 16, `frontend/`)

### 2.1 `src/proxy.ts`

Already fixed: the matcher excludes `auth/` so the OAuth callback can run.
For reference the last lines must read:

```ts
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|auth/).*)"],
};
```

### 2.2 `src/lib/types.ts` (full file)

```ts
export type Verdict =
  | "running"
  | "ready"
  | "ready_with_warnings"
  | "not_ready"
  | "error";

export type TestStatus = "passed" | "failed" | "flaky" | "skipped" | "error";

export interface TestResult {
  id: string;
  run_id: string;
  name: string;
  feature: string | null;
  priority: "P0" | "P1" | "P2";
  status: TestStatus;
  duration_ms: number | null;
  error: string | null;
  owner: string | null;
  screenshot_path: string | null;
  screenshot_url: string | null;
  created_at: string;
}

export interface Signoff {
  id: string;
  run_id: string;
  decision: "approve" | "block";
  comment: string | null;
  override_reason: string | null;
  decided_by_email: string;
  created_at: string;
}

export interface Run {
  id: string;
  project_id: string;
  branch: string;
  commit_sha: string | null;
  commit_message: string | null;
  trigger: string;
  environment: string;
  status: "running" | "completed" | "error";
  verdict: Verdict;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  duration_ms: number | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  tests?: TestResult[];
  signoffs?: Signoff[];
}

export interface Project {
  id: string;
  name: string;
  repo_url: string | null;
  branch: string;
  staging_url: string | null;
  alert_channel: string | null;
  created_at: string;
  last_run: { id: string; verdict: Verdict; created_at: string } | null;
}

/** Returned once by POST /api/projects — the raw key is never shown again. */
export interface ProjectCreated extends Project {
  api_key: string;
}

/** One row of GET /api/tests (FR-22). enabled === null: reported results but not in the manifest. */
export interface TestCatalogItem {
  name: string;
  feature: string | null;
  priority: "P0" | "P1" | "P2";
  owner: string | null;
  enabled: boolean | null;
  last_status: TestStatus | null;
  last_run_id: string | null;
  last_run_at: string | null;
}
```

### 2.3 `src/app/api/backend/[...path]/route.ts` (full file)

Two fixes: binary-safe body (dev-mode screenshots were corrupted by
`res.text()`), and the body is forwarded for any non-GET method.

```ts
// Proxy for the FastAPI backend: /api/backend/* -> FASTAPI_BASE_URL/api/*.
// Keeps the backend URL server-side and avoids CORS in the browser.
const FASTAPI_BASE_URL =
  process.env.FASTAPI_BASE_URL ?? "http://localhost:8000";

async function proxy(request: Request, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const { search } = new URL(request.url);
  const target = `${FASTAPI_BASE_URL}/api/${path.join("/")}${search}`;

  const headers = new Headers();
  // Forward only what the API needs; never forward cookies.
  for (const name of ["authorization", "x-api-key", "content-type"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const res = await fetch(target, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.text(),
    });
    // arrayBuffer, not text: dev-mode screenshots (PNG) come through here too.
    const body = await res.arrayBuffer();
    const out = new Headers({
      "content-type": res.headers.get("content-type") ?? "application/json",
    });
    const cache = res.headers.get("cache-control");
    if (cache) out.set("cache-control", cache);
    return new Response(body, { status: res.status, headers: out });
  } catch {
    return Response.json(
      { detail: "Backend is unreachable. Is uvicorn running on port 8000?" },
      { status: 502 },
    );
  }
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return proxy(request, ctx.params);
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return proxy(request, ctx.params);
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return proxy(request, ctx.params);
}
```

### 2.4 `src/lib/api.ts` (full file)

```ts
"use client";

import { createClient, supabaseConfigured } from "@/lib/supabase/client";

/**
 * All backend calls go through the /api/backend proxy (a Next.js route
 * handler), so the browser never needs to know the FastAPI URL and CORS
 * never applies. The Supabase access token is attached automatically;
 * FastAPI validates it (PRD FR-16). In dev mode (no Supabase configured)
 * no token is sent and FastAPI runs open against its in-memory store.
 */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  if (!supabaseConfigured) return {};
  const { data } = await createClient().auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api/backend${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(await authHeaders()),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    // FastAPI puts a string in "detail"; validation errors put an array there.
    const detail =
      typeof data.detail === "string"
        ? data.detail
        : JSON.stringify(data.detail ?? "");
    throw new ApiError(res.status, detail || `Request failed (${res.status})`);
  }
  return res.json();
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>("GET", path);
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>("POST", path, body);
}
```

### 2.5 `src/lib/format.ts` (new)

Shared by the dashboard, the run page and the tests page.

```ts
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function duration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

export const VERDICT_LABEL: Record<string, string> = {
  ready: "Ready",
  ready_with_warnings: "Ready with warnings",
  not_ready: "Not Ready",
  running: "Running",
  error: "Error",
};
```

### 2.6 `src/components/Navbar.tsx` (full file)

Adds Dashboard / Tests links.

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient, supabaseConfigured } from "@/lib/supabase/client";

export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const box =
    size === "lg"
      ? "h-11 w-11 rounded-2xl"
      : size === "sm"
        ? "h-8 w-8 rounded-lg"
        : "h-10 w-10 rounded-xl";
  const bolt = size === "lg" ? "h-5 w-5" : "h-4 w-4";
  return (
    <span
      className={`flex ${box} items-center justify-center bg-amber-500 shadow-lg shadow-black/40`}
    >
      <svg viewBox="0 0 24 24" className={bolt} aria-hidden="true">
        <path d="M13 2L4.5 13.5H11L9.5 22 19 10h-6.5L13 2z" fill="#ffffff" />
      </svg>
    </span>
  );
}

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/tests", label: "Tests" },
];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const bare = pathname === "/login" || pathname.startsWith("/auth");

  async function signOut() {
    try {
      if (supabaseConfigured) await createClient().auth.signOut();
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <header className="sticky top-0 z-10 border-b border-border/60 bg-background/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-3">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo size="sm" />
          <span className="font-semibold tracking-tight">Auto Tester</span>
        </Link>
        {!bare && (
          <>
            <nav className="ml-6 flex items-center gap-4 text-sm">
              {LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={
                    pathname === link.href
                      ? "text-foreground"
                      : "text-muted hover:text-foreground"
                  }
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <button
              onClick={signOut}
              className="ml-auto rounded-lg border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-foreground"
            >
              Sign out
            </button>
          </>
        )}
      </div>
    </header>
  );
}
```

### 2.7 `src/components/ConnectProjectDialog.tsx` (new, FR-25)

A modal with the five PRD fields. On save it shows the API key once with a
copy button and the GitHub settings to paste, then the dashboard refreshes.

```tsx
"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { apiPost, ApiError } from "@/lib/api";
import type { ProjectCreated } from "@/lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (project: ProjectCreated) => void;
};

const EMPTY = {
  name: "",
  repo_url: "",
  branch: "main",
  staging_url: "",
  alert_channel: "",
};

function githubSetup(apiKey: string, stagingUrl: string) {
  return [
    "# In the repo that runs the tests -> Settings -> Environments -> staging",
    "# Variables",
    `AUTOTESTER_API_URL=${location.origin.includes("localhost") ? "https://tester.zedu.chat" : location.origin}`,
    `AUTOTESTER_STAGING_URL=${stagingUrl}`,
    "# Secrets",
    `AUTOTESTER_API_KEY=${apiKey}`,
    "AUTOTESTER_USER_A_EMAIL=...   AUTOTESTER_USER_A_PASSWORD=...",
    "AUTOTESTER_USER_B_EMAIL=...   AUTOTESTER_USER_B_PASSWORD=...",
    "# Workflow file: .github/workflows/smoke.yml from the auto-tester repo",
  ].join("\n");
}

export default function ConnectProjectDialog({
  open,
  onClose,
  onCreated,
}: Props) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ProjectCreated | null>(null);
  const [copied, setCopied] = useState<"key" | "setup" | null>(null);

  if (!open) return null;

  const field =
    (name: keyof typeof EMPTY) => (e: ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [name]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.staging_url.startsWith("https://")) {
      setError("Staging URL must start with https://");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const project = await apiPost<ProjectCreated>("/projects", {
        name: form.name.trim(),
        repo_url: form.repo_url.trim() || null,
        branch: form.branch.trim() || "main",
        staging_url: form.staging_url.trim(),
        alert_channel: form.alert_channel.trim() || null,
      });
      setCreated(project);
      onCreated(project);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, what: "key" | "setup") {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  }

  function close() {
    setForm(EMPTY);
    setCreated(null);
    setError(null);
    onClose();
  }

  const input =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-panel p-6 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {created ? (
          <div className="flex flex-col gap-4">
            <h2 className="text-xl font-semibold">
              {created.name} is connected
            </h2>
            <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
              This API key is shown <strong>once</strong>. Store it as the
              GitHub secret AUTOTESTER_API_KEY now. Only its hash is kept on the
              server.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg border border-border bg-background p-3 text-xs">
                {created.api_key}
              </code>
              <button
                onClick={() => copy(created.api_key, "key")}
                className="rounded-lg border border-border px-3 py-2 text-sm hover:border-accent"
              >
                {copied === "key" ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-xs font-medium uppercase text-muted">
                  GitHub setup
                </p>
                <button
                  onClick={() =>
                    copy(
                      githubSetup(created.api_key, created.staging_url ?? ""),
                      "setup",
                    )
                  }
                  className="text-xs text-accent hover:underline"
                >
                  {copied === "setup" ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <pre className="overflow-x-auto rounded-lg border border-border bg-background p-3 text-xs text-muted">
                {githubSetup(created.api_key, created.staging_url ?? "")}
              </pre>
            </div>
            <button
              onClick={close}
              className="self-end rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <h2 className="text-xl font-semibold">Connect a project</h2>
              <p className="mt-1 text-sm text-muted">
                Staging only. The key you get back goes into GitHub secrets,
                never into code.
              </p>
            </div>
            <label className="text-sm">
              <span className="mb-1 block text-muted">Project name</span>
              <input
                className={input}
                required
                maxLength={120}
                value={form.name}
                onChange={field("name")}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted">
                GitHub repository URL
              </span>
              <input
                className={input}
                type="url"
                placeholder="https://github.com/zedu-yodaa/zedu"
                value={form.repo_url}
                onChange={field("repo_url")}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-muted">Branch</span>
                <input
                  className={input}
                  value={form.branch}
                  onChange={field("branch")}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted">
                  Zedu alert channel (optional)
                </span>
                <input
                  className={input}
                  placeholder="#releases"
                  value={form.alert_channel}
                  onChange={field("alert_channel")}
                />
              </label>
            </div>
            <label className="text-sm">
              <span className="mb-1 block text-muted">
                Staging URL (https only)
              </span>
              <input
                className={input}
                type="url"
                required
                placeholder="https://staging.zedu.chat"
                value={form.staging_url}
                onChange={field("staging_url")}
              />
            </label>
            {error && (
              <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-lg border border-border px-4 py-2 text-sm hover:border-accent"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-60"
              >
                {busy ? "Saving…" : "Create project"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
```

### 2.8 `src/app/page.tsx` (full file, FR-18)

Adds the Connect button and dialog, the run ID and status columns, and a
refresh every 15 s while any run is Running.

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, ApiError } from "@/lib/api";
import type { Project, Run } from "@/lib/types";
import { duration, timeAgo } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import ConnectProjectDialog from "@/components/ConnectProjectDialog";

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(() => {
    Promise.all([apiGet<Project[]>("/projects"), apiGet<Run[]>("/runs")])
      .then(([p, r]) => {
        setProjects(p);
        setRuns(r);
      })
      .catch((e: ApiError) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // FR-17 "Running": refresh while any run is still in progress.
  useEffect(() => {
    if (!runs?.some((r) => r.verdict === "running")) return;
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [runs, load]);

  if (error) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-400">
          {error}
        </p>
      </main>
    );
  }
  if (projects === null || runs === null) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="text-muted">Loading runs…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 flex flex-col gap-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Is this safe to release?
          </h1>
          <p className="mt-1.5 text-muted">
            Staging smoke runs, verdicts and failure evidence — in one place.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {runs.length > 0 && runs[0].verdict && (
            <StatusBadge verdict={runs[0].verdict} />
          )}
          <button
            onClick={() => setConnecting(true)}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400"
          >
            Connect project
          </button>
        </div>
      </div>

      <ConnectProjectDialog
        open={connecting}
        onClose={() => setConnecting(false)}
        onCreated={load}
      />

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted mb-3">
          Projects
        </h2>
        {projects.length === 0 ? (
          <p className="rounded-2xl border border-border bg-panel/80 p-6 text-muted">
            No projects connected yet. Click{" "}
            <strong className="text-foreground">Connect project</strong> to add
            Zedu, then store the key it gives you in GitHub.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={project.last_run ? `/runs/${project.last_run.id}` : "#"}
                className="group rounded-2xl border border-border bg-panel/80 p-5 shadow-lg shadow-black/20 transition-all hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-accent/10"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-medium">{project.name}</h3>
                  {project.last_run && (
                    <StatusBadge verdict={project.last_run.verdict} />
                  )}
                </div>
                <p className="mt-2 truncate text-sm text-muted">
                  {project.repo_url ?? "No repository"} · {project.branch}
                </p>
                <p className="mt-1 text-sm text-muted">
                  Last run: {timeAgo(project.last_run?.created_at)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted mb-3">
          Run history
        </h2>
        {runs.length === 0 ? (
          <p className="rounded-2xl border border-border bg-panel/80 p-6 text-muted">
            No runs yet. Post results from GitHub Actions to see them here.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-panel/40 shadow-lg shadow-black/20">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                  <th className="px-4 py-3 font-medium">Verdict</th>
                  <th className="px-4 py-3 font-medium">Run</th>
                  <th className="px-4 py-3 font-medium">Branch</th>
                  <th className="px-4 py-3 font-medium">Commit</th>
                  <th className="px-4 py-3 font-medium">Trigger</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Tests</th>
                  <th className="px-4 py-3 font-medium">Duration</th>
                  <th className="px-4 py-3 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    className="border-b border-border/60 last:border-0 hover:bg-panel/70 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link href={`/runs/${run.id}`}>
                        <StatusBadge verdict={run.verdict} />
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link
                        href={`/runs/${run.id}`}
                        className="hover:text-accent"
                      >
                        {run.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {run.branch}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {run.commit_sha ? run.commit_sha.slice(0, 8) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted">{run.trigger}</td>
                    <td className="px-4 py-3 text-muted">{run.status}</td>
                    <td className="px-4 py-3">
                      <span className="text-emerald-400">{run.passed}</span>
                      <span className="text-muted"> passed · </span>
                      <span
                        className={
                          run.failed > 0 ? "text-red-400" : "text-muted"
                        }
                      >
                        {run.failed} failed
                      </span>
                      {run.flaky > 0 && (
                        <span className="text-amber-400">
                          {" "}
                          · {run.flaky} flaky
                        </span>
                      )}
                      <span className="text-muted"> ({run.total})</span>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {duration(run.duration_ms)}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {timeAgo(run.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
```

### 2.9 `src/app/runs/[id]/run-details.tsx` (full file, FR-19/20/21/14/26/27)

New: polling while Running, a Flaky section with owners, the Re-run
button, a richer bug report, and the sign-off panel. The server page
`page.tsx` next to it stays as is.

```tsx
"use client";

import {
  use,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import type { Run, TestResult } from "@/lib/types";
import { duration, VERDICT_LABEL } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";

const STATUS_STYLES: Record<string, string> = {
  passed: "text-emerald-400",
  failed: "text-red-400",
  error: "text-red-400",
  flaky: "text-amber-400",
  skipped: "text-muted",
};

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
      {children}
    </span>
  );
}

function TestRow({ test }: { test: TestResult }) {
  return (
    <details className="group border-b border-border last:border-0">
      <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-panel/60 list-none [&::-webkit-details-marker]:hidden">
        <span
          className={`w-16 text-xs font-medium uppercase ${STATUS_STYLES[test.status] ?? "text-muted"}`}
        >
          {test.status}
        </span>
        <span className="flex-1 truncate">{test.name}</span>
        {test.feature && <Pill>{test.feature}</Pill>}
        <Pill>{test.priority}</Pill>
        {test.owner && <Pill>owner: {test.owner}</Pill>}
        {test.duration_ms != null && (
          <span className="w-16 text-right text-xs text-muted">
            {test.duration_ms}ms
          </span>
        )}
        <span className="text-muted group-open:rotate-90 transition-transform">
          ›
        </span>
      </summary>
      <div className="border-t border-border bg-background/60 px-4 py-4 flex flex-col gap-4">
        {test.error && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase text-muted">
              Error
            </p>
            <pre className="overflow-x-auto rounded-lg border border-border bg-panel p-3 text-xs text-red-300 whitespace-pre-wrap">
              {test.error}
            </pre>
          </div>
        )}
        {test.screenshot_url && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase text-muted">
              Screenshot
            </p>
            {/* Screenshot comes from our own API / signed URL, not remote hosts. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={test.screenshot_url}
              alt={`Failure screenshot: ${test.name}`}
              className="max-h-96 rounded-lg border border-border"
            />
          </div>
        )}
        {!test.error && !test.screenshot_url && (
          <p className="text-sm text-muted">No error details for this test.</p>
        )}
      </div>
    </details>
  );
}

function TestTable({ tests }: { tests: TestResult[] }) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {tests.map((t) => (
        <TestRow key={t.id} test={t} />
      ))}
    </div>
  );
}

/** FR-26 / FR-27: Approve or Block with a comment; override needed on Not Ready. */
function SignoffPanel({ run, onChanged }: { run: Run; onChanged: () => void }) {
  const blocked = run.verdict === "not_ready" || run.verdict === "error";
  const [decision, setDecision] = useState<"approve" | "block">(
    blocked ? "block" : "approve",
  );
  const [comment, setComment] = useState("");
  const [override, setOverride] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsOverride = decision === "approve" && blocked;
  const latest = run.signoffs?.[0];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/runs/${run.id}/signoff`, {
        decision,
        comment: comment.trim() || null,
        override_reason: needsOverride ? override.trim() || null : null,
      });
      setComment("");
      setOverride("");
      onChanged();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <section className="rounded-2xl border border-border bg-panel/80 p-5 shadow-lg shadow-black/20 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Release sign-off</h2>
        {latest ? (
          <span
            className={`rounded-full border px-3 py-1 text-sm ${
              latest.decision === "approve"
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                : "border-red-500/40 bg-red-500/15 text-red-300"
            }`}
          >
            {latest.decision === "approve" ? "Approved" : "Blocked"} by{" "}
            {latest.decided_by_email}
          </span>
        ) : (
          <span className="text-sm text-muted">No decision yet</span>
        )}
      </div>

      {run.signoffs && run.signoffs.length > 0 && (
        <ul className="flex flex-col gap-2 text-sm">
          {run.signoffs.map((s) => (
            <li
              key={s.id}
              className="rounded-lg border border-border/60 bg-background/60 px-3 py-2"
            >
              <span
                className={
                  s.decision === "approve" ? "text-emerald-400" : "text-red-400"
                }
              >
                {s.decision === "approve" ? "Approve" : "Block"}
              </span>
              <span className="text-muted">
                {" "}
                · {s.decided_by_email} ·{" "}
                {new Date(s.created_at).toLocaleString()}
              </span>
              {s.comment && <p className="mt-1">{s.comment}</p>}
              {s.override_reason && (
                <p className="mt-1 text-amber-300">
                  Override: {s.override_reason}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {run.verdict === "running" ? (
        <p className="text-sm text-muted">
          Sign-off opens when the run finishes.
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex gap-6 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="decision"
                checked={decision === "approve"}
                onChange={() => setDecision("approve")}
                className="accent-emerald-500"
              />
              Approve release
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="decision"
                checked={decision === "block"}
                onChange={() => setDecision("block")}
                className="accent-red-500"
              />
              Block release
            </label>
          </div>
          <textarea
            className={input}
            rows={2}
            placeholder="Comment (why)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          {needsOverride && (
            <label className="text-sm">
              <span className="mb-1 block text-amber-300">
                This run is {VERDICT_LABEL[run.verdict]}. An override reason is
                required to approve it.
              </span>
              <input
                className={input}
                required
                value={override}
                onChange={(e) => setOverride(e.target.value)}
                placeholder="e.g. failing test is a known staging data issue, ticket ZED-123"
              />
            </label>
          )}
          {error && (
            <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="self-start rounded-lg border border-border px-4 py-2 text-sm hover:border-accent disabled:opacity-60"
          >
            {busy ? "Saving…" : "Record decision"}
          </button>
        </form>
      )}
    </section>
  );
}

export default function RunDetails({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rerunMessage, setRerunMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<Run>(`/runs/${id}`)
      .then(setRun)
      .catch((e: ApiError) => setError(e.message));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // FR-17 "Running": poll until the runner finishes the run.
  useEffect(() => {
    if (run?.verdict !== "running") return;
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [run?.verdict, load]);

  // FR-21: Markdown bug report — name, steps, environment, commit, evidence link.
  async function copyReport() {
    if (!run) return;
    const evidenceUrl = `${location.origin}/runs/${run.id}`;
    const problems = (run.tests ?? []).filter((t) => t.status !== "passed");
    const lines = [
      `## Auto Tester run ${run.id.slice(0, 8)} — ${VERDICT_LABEL[run.verdict] ?? run.verdict}`,
      "",
      `- **Branch:** ${run.branch} @ ${run.commit_sha?.slice(0, 8) ?? "unknown"}`,
      `- **Environment:** ${run.environment} · trigger: ${run.trigger}`,
      `- **Tests:** ${run.passed} passed, ${run.failed} failed, ${run.flaky} flaky, ${run.skipped} skipped (of ${run.total})`,
      `- **Evidence:** ${evidenceUrl}`,
      "",
      ...problems.flatMap((t) => [
        `### ${t.status.toUpperCase()} · ${t.name}`,
        `- Feature: ${t.feature ?? "—"} · Priority: ${t.priority}${t.owner ? ` · Owner: ${t.owner}` : ""}`,
        `- Steps: in e2e/ run \`npx playwright test -g "${t.name}"\` against staging`,
        ...(t.error ? [`- Error: ${t.error.split("\n")[0]}`] : []),
        ...(t.screenshot_url
          ? [`- Screenshot: ${new URL(t.screenshot_url, location.origin).href}`]
          : []),
        "",
      ]),
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // FR-14
  async function rerun() {
    if (!run) return;
    setRerunMessage(null);
    try {
      await apiPost(`/runs/${run.id}/rerun`, {});
      setRerunMessage(
        "Re-run requested. A new Running row appears on the dashboard within a minute.",
      );
    } catch (err) {
      setRerunMessage((err as ApiError).message);
    }
  }

  if (error) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-400">
          {error}
        </p>
      </main>
    );
  }
  if (!run) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="text-muted">Loading run…</p>
      </main>
    );
  }

  const tests = run.tests ?? [];
  const failing = tests.filter(
    (t) => t.status === "failed" || t.status === "error",
  );
  const flaky = tests.filter((t) => t.status === "flaky");

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 flex flex-col gap-6">
      <div className="flex items-center gap-3 text-sm text-muted">
        <Link href="/" className="hover:text-foreground">
          ← Dashboard
        </Link>
        <span>/</span>
        <span className="font-mono">{run.id.slice(0, 8)}</span>
      </div>

      {/* Summary bar — FR-19 */}
      <div className="rounded-2xl border border-border bg-panel/80 p-5 shadow-lg shadow-black/20 flex flex-wrap items-center gap-x-8 gap-y-3">
        <StatusBadge verdict={run.verdict} />
        <div className="text-sm">
          <span className="text-emerald-400 font-medium">{run.passed}</span>
          <span className="text-muted"> passed</span>
        </div>
        <div className="text-sm">
          <span
            className={
              run.failed > 0 ? "text-red-400 font-medium" : "text-muted"
            }
          >
            {run.failed}
          </span>
          <span className="text-muted"> failed</span>
        </div>
        <div className="text-sm">
          <span
            className={
              run.flaky > 0 ? "text-amber-400 font-medium" : "text-muted"
            }
          >
            {run.flaky}
          </span>
          <span className="text-muted"> flaky</span>
        </div>
        <div className="text-sm text-muted">
          {run.total} tests · {duration(run.duration_ms)}
        </div>
        <div className="text-sm text-muted font-mono">
          {run.branch} @ {run.commit_sha?.slice(0, 8) ?? "unknown"} ·{" "}
          {run.trigger}
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={rerun}
            disabled={run.verdict === "running"}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent transition-colors disabled:opacity-50"
          >
            Re-run
          </button>
          <button
            onClick={copyReport}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent transition-colors"
          >
            {copied ? "Copied ✓" : "Copy bug report"}
          </button>
        </div>
      </div>

      {rerunMessage && <p className="text-sm text-muted">{rerunMessage}</p>}
      {run.commit_message && (
        <p className="text-sm text-muted">{run.commit_message}</p>
      )}
      {run.verdict === "running" && (
        <p className="text-sm text-sky-300">
          Tests are running on GitHub Actions. This page refreshes itself.
        </p>
      )}

      {failing.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3 text-red-400">
            {failing.length} failing test{failing.length > 1 ? "s" : ""}
          </h2>
          <TestTable tests={failing} />
        </section>
      )}

      {/* FR-20: flaky tests apart from failures, with owners */}
      {flaky.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-1 text-amber-400">
            {flaky.length} flaky test{flaky.length > 1 ? "s" : ""}
          </h2>
          <p className="mb-3 text-sm text-muted">
            Failed, then passed on retry. Not blocking the release — the owner
            should stabilise it.
          </p>
          <TestTable tests={flaky} />
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-3">
          All tests ({tests.length})
        </h2>
        {tests.length === 0 ? (
          <p className="rounded-xl border border-border bg-panel p-6 text-muted">
            {run.verdict === "running"
              ? "Waiting for results…"
              : "This run reported no tests."}
          </p>
        ) : (
          <TestTable tests={tests} />
        )}
      </section>

      <SignoffPanel run={run} onChanged={load} />
    </main>
  );
}
```

### 2.10 `src/app/tests/page.tsx` (new, FR-22)

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, ApiError } from "@/lib/api";
import type { TestCatalogItem } from "@/lib/types";
import { timeAgo } from "@/lib/format";

const RESULT_STYLES: Record<string, string> = {
  passed: "text-emerald-400",
  failed: "text-red-400",
  error: "text-red-400",
  flaky: "text-amber-400",
  skipped: "text-muted",
};

export default function TestsPage() {
  const [items, setItems] = useState<TestCatalogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<TestCatalogItem[]>("/tests")
      .then(setItems)
      .catch((e: ApiError) => setError(e.message));
  }, []);

  if (error) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-400">
          {error}
        </p>
      </main>
    );
  }
  if (!items) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="text-muted">Loading tests…</p>
      </main>
    );
  }

  const enabled = items.filter((t) => t.enabled !== false).length;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Starter tests</h1>
        <p className="mt-1.5 text-muted">
          {items.length} tests · {enabled} enabled. This list is read-only: edit{" "}
          <code className="text-accent">e2e/manifest.json</code> and add a spec
          to change it.
        </p>
      </div>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-border bg-panel/80 p-6 text-muted">
          No tests yet. Add entries to the manifest and run the smoke workflow
          once.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-panel/40 shadow-lg shadow-black/20">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                <th className="px-4 py-3 font-medium">Enabled</th>
                <th className="px-4 py-3 font-medium">Test</th>
                <th className="px-4 py-3 font-medium">Feature</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Last result</th>
                <th className="px-4 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr
                  key={t.name}
                  className="border-b border-border/60 last:border-0"
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={t.enabled ?? true}
                      disabled
                      readOnly
                      aria-label={`${t.name} enabled`}
                      title={
                        t.enabled === null
                          ? "Not in the manifest"
                          : "Read-only: edit e2e/manifest.json"
                      }
                      className="accent-amber-500"
                    />
                  </td>
                  <td className="px-4 py-3">{t.name}</td>
                  <td className="px-4 py-3 text-muted">{t.feature ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{t.priority}</td>
                  <td className="px-4 py-3 text-muted">{t.owner ?? "—"}</td>
                  <td
                    className={`px-4 py-3 text-xs font-medium uppercase ${RESULT_STYLES[t.last_status ?? ""] ?? "text-muted"}`}
                  >
                    {t.last_run_id ? (
                      <Link
                        href={`/runs/${t.last_run_id}`}
                        className="hover:underline"
                      >
                        {t.last_status}
                      </Link>
                    ) : (
                      "never run"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {timeAgo(t.last_run_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
```

### 2.11 Login page: show the callback error

In `src/app/login/page.tsx`, replace the line
`const [error, setError] = useState<string | null>(null);` with:

```tsx
const authError = searchParams.get("error");
const [error, setError] = useState<string | null>(
  authError === "auth"
    ? "Google sign-in did not complete. Please try again."
    : null,
);
```

### 2.12 `frontend/.env.example` (new; the docs referenced it but it never existed)

```bash
# Supabase project (Project Settings -> API). Leave both empty to run without login (dev mode).
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
# Where the FastAPI backend runs (server-side only, used by the /api/backend proxy)
FASTAPI_BASE_URL=http://localhost:8000
```

Vercel needs the same three variables.

---

## Part 3 — The runner (`e2e/`)

Layout (FR-1: one folder per feature under `tests/`):

```
e2e/
  package.json  tsconfig.json  .gitignore  manifest.json  playwright.config.ts
  fixtures/users.ts   fixtures/test.ts
  pages/zedu.ts
  tests/global.setup.ts
  tests/auth/login.spec.ts
  tests/channels/create-join.spec.ts
  tests/messaging/send-receive.spec.ts
  tests/messaging/direct-message.spec.ts
  tests/threads/reply.spec.ts
  tests/files/upload.spec.ts
  tests/notifications/  tests/calls/  tests/search/  tests/settings/   (empty folders with a .gitkeep, for the squads)
  scripts/lib.mjs  scripts/health-check.mjs  scripts/start-run.mjs  scripts/post-results.mjs
```

### 3.1 `e2e/package.json`, `tsconfig.json`, `.gitignore`

`@playwright/test` is a **new dependency**: get the tech lead's approval
first (PRD working rules). Write `package.json` by hand without the
`devDependencies` block, then let npm add them pinned and write the lockfile:

```json
{
  "name": "auto-tester-e2e",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "playwright test",
    "test:ui": "playwright test --ui",
    "health": "node scripts/health-check.mjs",
    "start-run": "node scripts/start-run.mjs",
    "post-results": "node scripts/post-results.mjs"
  }
}
```

```bash
cd e2e
snare gate -- npm install --save-dev --save-exact --ignore-scripts @playwright/test@1.64.1 @types/node@22
npm install --save-dev --save-exact --ignore-scripts @playwright/test@1.64.1 @types/node@22
npx playwright install chromium        # browsers are installed explicitly, never via postinstall
```

(1.64.1 is the current release as of today; check with `npm view @playwright/test version`.)

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["**/*.ts"]
}
```

`.gitignore`:

```
node_modules/
.auth/
test-results/
report/
playwright-report/
```

### 3.2 `e2e/manifest.json` (FR-2)

Names must equal the spec titles **without** the `@tags`. Owners are squad
names (FR-20). `enabled: false` removes a test from every run without
touching code (the config turns this into `grepInvert`).

```json
{
  "tests": [
    {
      "name": "staging is reachable",
      "feature": "environment",
      "priority": "P0",
      "owner": "platform-ci",
      "enabled": true
    },
    {
      "name": "authenticate userA",
      "feature": "auth",
      "priority": "P0",
      "owner": "platform-ci",
      "enabled": true
    },
    {
      "name": "authenticate userB",
      "feature": "auth",
      "priority": "P0",
      "owner": "platform-ci",
      "enabled": true
    },
    {
      "name": "login shows the sidebar",
      "feature": "auth",
      "priority": "P0",
      "owner": "auth-channels",
      "enabled": true
    },
    {
      "name": "logout returns to the login page",
      "feature": "auth",
      "priority": "P1",
      "owner": "auth-channels",
      "enabled": true
    },
    {
      "name": "create a channel and a second user joins it",
      "feature": "channels",
      "priority": "P0",
      "owner": "auth-channels",
      "enabled": true
    },
    {
      "name": "message sent by user A reaches user B",
      "feature": "messaging",
      "priority": "P0",
      "owner": "messaging-threads-dms",
      "enabled": true
    },
    {
      "name": "direct message reaches the recipient",
      "feature": "messaging",
      "priority": "P0",
      "owner": "messaging-threads-dms",
      "enabled": true
    },
    {
      "name": "thread reply is visible to the other user",
      "feature": "threads",
      "priority": "P0",
      "owner": "messaging-threads-dms",
      "enabled": true
    },
    {
      "name": "file upload shows the file in the channel",
      "feature": "files",
      "priority": "P0",
      "owner": "files-search-settings",
      "enabled": true
    }
  ]
}
```

### 3.3 `e2e/playwright.config.ts` (FR-12 + staging allow-list)

```ts
import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "https://staging.zedu.chat";

// NFR Safety: refuse to run against anything that is not an allow-listed staging host.
const ALLOWED_HOSTS = (
  process.env.STAGING_ALLOWLIST ?? "staging.zedu.chat,localhost"
)
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
const host = new URL(BASE_URL).hostname.toLowerCase();
if (
  !ALLOWED_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  )
) {
  throw new Error(
    `Refusing to run against ${host}: not a staging host (allowed: ${ALLOWED_HOSTS.join(", ")})`,
  );
}

// FR-2: tests switched off in the manifest never run.
const manifest = JSON.parse(
  readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
) as {
  tests: Array<{ name: string; enabled?: boolean }>;
};
const disabled = manifest.tests
  .filter((t) => t.enabled === false)
  .map((t) => t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0, // FR-12: retry twice, in CI only
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  grepInvert: disabled.length ? new RegExp(disabled.join("|")) : undefined,
  reporter: process.env.CI
    ? [["list"], ["json", { outputFile: "report/results.json" }]]
    : [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL: BASE_URL,
    screenshot: "only-on-failure", // FR-12
    trace: "on-first-retry", // FR-12
    video: "off",
    actionTimeout: 15_000,
  },
  projects: [
    { name: "setup", testMatch: /global\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testIgnore: /global\.setup\.ts/,
    },
  ],
});
```

### 3.4 `e2e/fixtures/users.ts` (FR-3) and `e2e/fixtures/test.ts` (FR-4, FR-5)

```ts
// fixtures/users.ts
import path from "node:path";

export type Role = "userA" | "userB";

/** FR-3: credentials come only from environment variables — never from code. */
function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `Missing ${name}. Test credentials come from environment variables only.`,
    );
  return value;
}

type User = {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
};

// Getters so importing this file without the env set does not throw.
export const USERS: Record<Role, User> = {
  userA: {
    get email() {
      return required("USER_A_EMAIL");
    },
    get password() {
      return required("USER_A_PASSWORD");
    },
    get displayName() {
      return process.env.USER_A_NAME ?? required("USER_A_EMAIL");
    },
  },
  userB: {
    get email() {
      return required("USER_B_EMAIL");
    },
    get password() {
      return required("USER_B_PASSWORD");
    },
    get displayName() {
      return process.env.USER_B_NAME ?? required("USER_B_EMAIL");
    },
  },
};

/** Where global.setup.ts saves each role's logged-in browser state. */
export const statePath = (role: Role) => path.join(".auth", `${role}.json`);
```

```ts
// fixtures/test.ts
import { test as base, expect, type Page } from "@playwright/test";
import { statePath } from "./users";

/** Prefix for everything a test creates (FR-5). CI sets RUN_TAG=gh-<run number>. */
export const RUN_TAG = (
  process.env.RUN_TAG ?? `local-${Date.now().toString(36)}`
).toLowerCase();

type Fixtures = {
  /** Logged-in page for test user A, in its own browser context. */
  userA: Page;
  /** Logged-in page for test user B — a second, isolated context (FR-4). */
  userB: Page;
  /** unique("chan") -> "gh-42-ab12cd-chan": run-ID prefixed, so leftovers are easy to find. */
  unique: (label: string) => string;
  /** Register a cleanup step; steps run in reverse order after the test, even when it failed. */
  cleanup: (step: () => Promise<void>) => void;
};

export const test = base.extend<Fixtures>({
  userA: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: statePath("userA"),
    });
    await use(await context.newPage());
    await context.close();
  },
  userB: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: statePath("userB"),
    });
    await use(await context.newPage());
    await context.close();
  },
  // eslint-disable-next-line no-empty-pattern
  unique: async ({}, use, testInfo) => {
    const short = testInfo.testId.slice(0, 6);
    await use((label) => `${RUN_TAG}-${short}-${label}`.toLowerCase());
  },
  // eslint-disable-next-line no-empty-pattern
  cleanup: async ({}, use) => {
    const steps: Array<() => Promise<void>> = [];
    await use((step) => {
      steps.push(step);
    });
    for (const step of steps.reverse()) {
      try {
        await step();
      } catch (error) {
        console.warn("cleanup step failed:", error);
      }
    }
  },
});

export { expect };
```

### 3.5 `e2e/pages/zedu.ts` — the page object (core helpers)

Every Zedu selector lives here, so a UI change is a one-file fix. The
lines marked `TODO` are educated guesses: open staging, use
`npx playwright codegen https://staging.zedu.chat` to see the real roles and
labels, and ask the product team for `data-testid` where nothing stable
exists (PRD open question 6). No fixed sleeps anywhere: every wait is an
auto-waiting `expect`.

```ts
import { expect, type Locator, type Page } from "@playwright/test";

export class Zedu {
  constructor(readonly page: Page) {}

  // --- auth -----------------------------------------------------------------
  async login(email: string, password: string) {
    await this.page.goto("/login");
    await this.page.getByLabel(/email/i).fill(email); // TODO confirm label
    await this.page.getByLabel(/password/i).fill(password); // TODO confirm label
    await this.page.getByRole("button", { name: /log in|sign in/i }).click(); // TODO confirm text
    await expect(this.sidebar()).toBeVisible();
  }

  async logout() {
    await this.page.getByTestId("user-menu").click(); // TODO data-testid
    await this.page
      .getByRole("menuitem", { name: /log out|sign out/i })
      .click();
    await expect(this.page).toHaveURL(/login/);
  }

  sidebar(): Locator {
    return this.page.getByTestId("sidebar"); // TODO data-testid
  }

  // --- channels --------------------------------------------------------------
  async createChannel(name: string) {
    await this.page
      .getByRole("button", { name: /new channel|create channel/i })
      .click(); // TODO
    await this.page.getByLabel(/channel name/i).fill(name);
    await this.page.getByRole("button", { name: /^create$/i }).click();
    await expect(this.page.getByRole("heading", { name })).toBeVisible();
  }

  async joinChannel(name: string) {
    await this.page.getByRole("button", { name: /browse channels/i }).click(); // TODO
    await this.page.getByPlaceholder(/search/i).fill(name);
    await this.page
      .getByRole("button", { name: /^join$/i })
      .first()
      .click();
    await expect(this.page.getByRole("heading", { name })).toBeVisible();
  }

  async openChannel(name: string) {
    await this.sidebar().getByRole("link", { name, exact: true }).click();
    await expect(this.page.getByRole("heading", { name })).toBeVisible();
  }

  /** Cleanup helper (FR-5). Archive instead if Zedu has no delete. */
  async deleteChannel(name: string) {
    await this.openChannel(name);
    await this.page.getByRole("button", { name: /channel settings/i }).click(); // TODO
    await this.page.getByRole("menuitem", { name: /delete channel/i }).click();
    await this.page.getByRole("button", { name: /^delete$/i }).click();
    await expect(
      this.sidebar().getByRole("link", { name, exact: true }),
    ).toHaveCount(0);
  }

  // --- messages --------------------------------------------------------------
  composer(): Locator {
    return this.page.getByRole("textbox", { name: /message/i }); // TODO
  }

  messageList(): Locator {
    return this.page.getByTestId("message-list"); // TODO data-testid
  }

  async sendMessage(text: string) {
    await this.composer().fill(text);
    await this.composer().press("Enter");
    await this.expectMessage(text);
  }

  /** Waits for real-time delivery — no reload, no sleep (NFR Waiting). */
  async expectMessage(text: string) {
    await expect(
      this.messageList().getByText(text, { exact: true }),
    ).toBeVisible({ timeout: 20_000 });
  }

  threadPanel(): Locator {
    return this.page.getByTestId("thread-panel"); // TODO data-testid
  }

  async openThread(messageText: string) {
    await this.messageList().getByText(messageText, { exact: true }).hover();
    await this.page
      .getByRole("button", { name: /reply in thread|replies/i })
      .click(); // TODO
    await expect(this.threadPanel()).toBeVisible();
  }

  async replyInThread(messageText: string, reply: string) {
    await this.openThread(messageText);
    const box = this.threadPanel().getByRole("textbox");
    await box.fill(reply);
    await box.press("Enter");
    await expect(
      this.threadPanel().getByText(reply, { exact: true }),
    ).toBeVisible();
  }

  async openDirectMessage(displayName: string) {
    await this.page
      .getByRole("button", { name: /new message|direct message/i })
      .click(); // TODO
    await this.page.getByPlaceholder(/search people|to:/i).fill(displayName);
    await this.page.getByRole("option", { name: displayName }).click();
    await expect(
      this.page.getByRole("heading", { name: displayName }),
    ).toBeVisible();
  }

  async uploadFile(fileName: string, content: string) {
    await this.page
      .locator('input[type="file"]')
      .setInputFiles({
        name: fileName,
        mimeType: "text/plain",
        buffer: Buffer.from(content),
      });
    await this.page.getByRole("button", { name: /^send$|upload/i }).click(); // TODO
    await expect(this.messageList().getByText(fileName)).toBeVisible();
  }
}
```

### 3.6 `e2e/tests/global.setup.ts` (FR-3, FR-7 inside the suite)

Runs once before the `chromium` project: a reachability check, then one
login per role saved to `.auth/<role>.json`.

```ts
import { test as setup, expect } from "@playwright/test";
import { USERS, statePath } from "../fixtures/users";
import { Zedu } from "../pages/zedu";

setup("staging is reachable @P0 @environment", async ({ request }) => {
  const response = await request.get("/", {
    timeout: 15_000,
    failOnStatusCode: false,
  });
  expect(
    response.status(),
    "ENVIRONMENT_DOWN: staging did not answer",
  ).toBeLessThan(500);
});

for (const role of ["userA", "userB"] as const) {
  setup(`authenticate ${role} @P0 @auth`, async ({ page }) => {
    const user = USERS[role];
    await new Zedu(page).login(user.email, user.password);
    await page.context().storageState({ path: statePath(role) });
  });
}
```

### 3.7 The six core-flow specs (FR-6)

Titles carry `@P0`/`@P1` and a feature tag; the manifest name is the
title without tags.

```ts
// tests/auth/login.spec.ts
import { test, expect } from "../../fixtures/test";
import { USERS } from "../../fixtures/users";
import { Zedu } from "../../pages/zedu";

test("login shows the sidebar @P0 @auth", async ({ userA }) => {
  await userA.goto("/");
  await expect(new Zedu(userA).sidebar()).toBeVisible();
});

test("logout returns to the login page @P1 @auth", async ({ browser }) => {
  // Fresh context: logging out must not invalidate the saved session other tests use.
  const context = await browser.newContext();
  const zedu = new Zedu(await context.newPage());
  await zedu.login(USERS.userA.email, USERS.userA.password);
  await zedu.logout();
  await expect(zedu.page).toHaveURL(/login/);
  await context.close();
});
```

```ts
// tests/channels/create-join.spec.ts
import { test, expect } from "../../fixtures/test";
import { Zedu } from "../../pages/zedu";

test("create a channel and a second user joins it @P0 @channels", async ({
  userA,
  userB,
  unique,
  cleanup,
}) => {
  const a = new Zedu(userA);
  const b = new Zedu(userB);
  const channel = unique("chan");

  await userA.goto("/");
  await a.createChannel(channel);
  cleanup(() => a.deleteChannel(channel));

  await userB.goto("/");
  await b.joinChannel(channel);
  await expect(
    b.sidebar().getByRole("link", { name: channel, exact: true }),
  ).toBeVisible();
});
```

```ts
// tests/messaging/send-receive.spec.ts  (FR-4: two contexts, real-time delivery)
import { test } from "../../fixtures/test";
import { Zedu } from "../../pages/zedu";

test("message sent by user A reaches user B @P0 @messaging", async ({
  userA,
  userB,
  unique,
  cleanup,
}) => {
  const a = new Zedu(userA);
  const b = new Zedu(userB);
  const channel = unique("msg");

  await userA.goto("/");
  await a.createChannel(channel);
  cleanup(() => a.deleteChannel(channel));

  await userB.goto("/");
  await b.joinChannel(channel);

  const text = `hello from A ${unique("t")}`;
  await a.sendMessage(text);
  await b.expectMessage(text); // B never reloads: this proves real-time delivery
});
```

```ts
// tests/messaging/direct-message.spec.ts
import { test } from "../../fixtures/test";
import { USERS } from "../../fixtures/users";
import { Zedu } from "../../pages/zedu";

test("direct message reaches the recipient @P0 @messaging", async ({
  userA,
  userB,
  unique,
}) => {
  const a = new Zedu(userA);
  const b = new Zedu(userB);

  await userA.goto("/");
  await a.openDirectMessage(USERS.userB.displayName);
  const text = `dm ${unique("t")}`;
  await a.sendMessage(text);

  await userB.goto("/");
  await b.openDirectMessage(USERS.userA.displayName);
  await b.expectMessage(text);
});
```

```ts
// tests/threads/reply.spec.ts
import { test, expect } from "../../fixtures/test";
import { Zedu } from "../../pages/zedu";

test("thread reply is visible to the other user @P0 @threads", async ({
  userA,
  userB,
  unique,
  cleanup,
}) => {
  const a = new Zedu(userA);
  const b = new Zedu(userB);
  const channel = unique("thr");

  await userA.goto("/");
  await a.createChannel(channel);
  cleanup(() => a.deleteChannel(channel));
  await userB.goto("/");
  await b.joinChannel(channel);

  const root = `root ${unique("m")}`;
  const reply = `reply ${unique("r")}`;
  await a.sendMessage(root);
  await b.expectMessage(root);
  await b.replyInThread(root, reply);

  await a.openThread(root);
  await expect(a.threadPanel().getByText(reply, { exact: true })).toBeVisible({
    timeout: 20_000,
  });
});
```

```ts
// tests/files/upload.spec.ts
import { test } from "../../fixtures/test";
import { Zedu } from "../../pages/zedu";

test("file upload shows the file in the channel @P0 @files", async ({
  userA,
  unique,
  cleanup,
}) => {
  const a = new Zedu(userA);
  const channel = unique("file");

  await userA.goto("/");
  await a.createChannel(channel);
  cleanup(() => a.deleteChannel(channel));

  const fileName = `${unique("note")}.txt`;
  await a.uploadFile(fileName, `Auto Tester upload ${fileName}`);
});
```

Run locally against staging before pushing (PRD rule: one passing local run):

```bash
cd e2e
export BASE_URL=https://staging.zedu.chat USER_A_EMAIL=... USER_A_PASSWORD=... USER_B_EMAIL=... USER_B_PASSWORD=...
npx playwright test --project=chromium -g "login shows the sidebar"
```

### 3.8 Scripts: `lib.mjs`, `health-check.mjs`, `start-run.mjs`, `post-results.mjs`

Zero dependencies on purpose (supply-chain rule).

```js
// scripts/lib.mjs
import { execSync } from "node:child_process";

export function apiConfig() {
  const url = process.env.AUTOTESTER_API_URL?.replace(/\/+$/, "");
  const key = process.env.AUTOTESTER_API_KEY;
  if (!url || !key) {
    console.error("AUTOTESTER_API_URL and AUTOTESTER_API_KEY are required");
    process.exit(1);
  }
  return {
    url,
    headers: { "Content-Type": "application/json", "X-API-Key": key },
  };
}

export function runMeta() {
  let commitMessage = process.env.COMMIT_MESSAGE ?? null;
  if (!commitMessage) {
    try {
      commitMessage = execSync("git log -1 --pretty=%s", {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim()
        .slice(0, 500);
    } catch {
      /* not a git checkout */
    }
  }
  return {
    branch: process.env.GITHUB_REF_NAME ?? "main",
    commit: process.env.GITHUB_SHA ?? null,
    commit_message: commitMessage,
    trigger: process.env.TRIGGER ?? "manual",
    environment: "staging",
  };
}
```

```js
// scripts/health-check.mjs  (FR-7)
// Writes up=true|false to GITHUB_OUTPUT. Never fails the job: a down environment
// is reported by post-results.mjs as one "Environment down" error, not as test failures.
import { appendFileSync } from "node:fs";

const targets = [process.env.BASE_URL, process.env.API_HEALTH_URL].filter(
  Boolean,
);
if (targets.length === 0) {
  console.error("BASE_URL is required");
  process.exit(1);
}

async function responds(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    console.log(`${url} -> HTTP ${res.status}`);
    return res.status < 500;
  } catch (error) {
    console.log(`${url} -> ${error.message}`);
    return false;
  }
}

const results = await Promise.all(targets.map(responds));
const up = results.every(Boolean);
console.log(
  up ? "Environment up" : "ENVIRONMENT DOWN — UI tests will be skipped",
);
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `up=${up}\n`);
```

```js
// scripts/start-run.mjs
// Registers the run as "running" so the dashboard shows it at once (FR-17).
// Prints run_id to GITHUB_OUTPUT; post-results.mjs PATCHes that run when tests finish.
import { appendFileSync } from "node:fs";
import { apiConfig, runMeta } from "./lib.mjs";

const { url, headers } = apiConfig();
const payload = {
  ...runMeta(),
  status: "running",
  started_at: new Date().toISOString(),
  tests: [],
};

try {
  const res = await fetch(`${url}/api/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  console.log(`Run registered: ${body.id}`);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `run_id=${body.id}\n`);
} catch (error) {
  // Not fatal: post-results.mjs creates the run at the end instead.
  console.warn(`Could not register the run: ${error.message}`);
}
```

```js
// scripts/post-results.mjs
// Converts Playwright's JSON report into the Auto Tester payload and sends it.
//   AUTOTESTER_RUN_ID set  -> PATCH /api/runs/{id}  (finishes the "running" run)
//   otherwise              -> POST  /api/runs
// Flaky detection (FR-20), priorities from @P0/@P1 tags, owners from the manifest,
// failure screenshots from the report's attachments (FR-12/FR-19).
import { existsSync, readFileSync } from "node:fs";
import { apiConfig, runMeta } from "./lib.mjs";

const { url, headers } = apiConfig();
const runId = process.env.AUTOTESTER_RUN_ID || null;
const envDown = process.env.ENV_DOWN === "true";
const reportPath = process.env.REPORT_PATH ?? "report/results.json";
const MAX_SCREENSHOTS = 25; // API limit per run

let manifest = [];
try {
  manifest = JSON.parse(readFileSync("manifest.json", "utf8")).tests ?? [];
} catch {
  /* no manifest: priorities default to P0, owners to null */
}
const byName = new Map(manifest.map((t) => [t.name, t]));

const stripAnsi = (s) => (s ?? "").replace(/\u001b\[[0-9;]*m/g, "");
const cleanTitle = (title) => title.replace(/\s*@\w+/g, "").trim();
const priorityOf = (title, fallback) =>
  /@(P[012])\b/.exec(title)?.[1] ?? fallback;
function featureOf(file) {
  // "messaging/send-receive.spec.ts" or "tests/messaging/x.spec.ts" -> "messaging"
  const dirs = file
    .split(/[\\/]/)
    .filter(Boolean)
    .slice(0, -1)
    .filter((d) => d !== "tests");
  return dirs[0] ?? null;
}

function collectSpecs(suite, file = "", out = []) {
  const current = suite.file ?? file;
  for (const spec of suite.specs ?? [])
    out.push({ ...spec, file: spec.file ?? current });
  for (const child of suite.suites ?? []) collectSpecs(child, current, out);
  return out;
}

function toTest(spec) {
  const name = cleanTitle(spec.title);
  const entry = byName.get(name);
  const result = spec.tests?.[0]; // one project per spec (setup or chromium)
  const attempts = result?.results ?? [];
  const last = attempts[attempts.length - 1];

  let status;
  switch (result?.status) {
    case "expected":
      status = "passed";
      break;
    case "flaky":
      status = "flaky";
      break; // failed, then passed on retry (FR-20)
    case "skipped":
      status = "skipped";
      break;
    case "unexpected":
      status = last?.status === "interrupted" ? "error" : "failed";
      break;
    default:
      status = "error";
  }

  const failedAttempt = [...attempts]
    .reverse()
    .find((a) => a.status !== "passed" && a.status !== "skipped");
  const error = failedAttempt?.error
    ? stripAnsi(
        failedAttempt.error.message ?? failedAttempt.error.stack ?? "",
      ).slice(0, 8000)
    : null;

  const test = {
    name,
    feature: entry?.feature ?? featureOf(spec.file ?? ""),
    priority: priorityOf(spec.title, entry?.priority ?? "P0"),
    status,
    duration_ms: attempts.reduce((sum, a) => sum + (a.duration ?? 0), 0),
    error,
    owner: entry?.owner ?? null,
  };

  if (status === "failed" || status === "error") {
    const shot = (failedAttempt?.attachments ?? []).find(
      (a) => a.contentType === "image/png" && a.path && existsSync(a.path),
    );
    if (shot)
      test.screenshot_base64 = readFileSync(shot.path).toString("base64");
  }
  return test;
}

let tests = [];
if (envDown) {
  tests = [
    {
      name: "Environment down: staging did not respond",
      feature: "environment",
      priority: "P0",
      status: "error",
      error: `Health check failed for ${process.env.BASE_URL ?? "BASE_URL"}. UI tests were not run.`,
    },
  ];
} else if (existsSync(reportPath)) {
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  tests = collectSpecs({ suites: report.suites ?? [] }).map(toTest);
  let shots = 0;
  for (const t of tests)
    if (t.screenshot_base64 && ++shots > MAX_SCREENSHOTS)
      delete t.screenshot_base64;
} else {
  console.warn(`No report at ${reportPath}`);
}
if (tests.length === 0) {
  tests = [
    {
      name: "runner produced no results",
      feature: "runner",
      priority: "P0",
      status: "error",
      error: `No Playwright report found at ${reportPath}`,
    },
  ];
}

const status = envDown ? "error" : "completed";
const finished_at = new Date().toISOString();
const res = runId
  ? await fetch(`${url}/api/runs/${runId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status, finished_at, tests }),
    })
  : await fetch(`${url}/api/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...runMeta(), status, finished_at, tests }),
    });

const body = await res.text();
console.log(`Auto Tester ingest: ${res.status} ${body.slice(0, 500)}`);
if (!res.ok) process.exit(1);
```

### 3.9 `.github/workflows/smoke.yml` (FR-9, FR-10, FR-11, FR-7, FR-15)

The existing `malware-ci-gate.yml` and `deploy.yml` stay. This is the
runner workflow. Secrets live in a GitHub **environment** named `staging`
(repo → Settings → Environments → New environment).

```yaml
name: Auto Tester smoke run

# FR-9 manual (Run now), FR-10 nightly, FR-11 push/PR of this repo.
on:
  workflow_dispatch:
    inputs:
      environment:
        description: Target environment (staging only — NFR Safety)
        type: choice
        options: [staging]
        default: staging
      tag:
        description: "Only run tests with this tag, e.g. @P0 or @messaging (empty = all)"
        type: string
        default: ""
      trigger:
        description: Recorded on the run (manual or re-run)
        type: string
        default: manual
  schedule:
    - cron: "0 2 * * *"
  push:
    branches: [main]
    paths: ["e2e/**", ".github/workflows/smoke.yml"]
  pull_request:
    paths: ["e2e/**", ".github/workflows/smoke.yml"]

permissions:
  contents: read # NFR Security: read-only default token

concurrency:
  group: smoke-${{ github.ref }}
  cancel-in-progress: false

jobs:
  smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 15 # NFR Speed
    environment: staging
    defaults:
      run:
        working-directory: e2e
    env:
      CI: "true"
      BASE_URL: ${{ vars.AUTOTESTER_STAGING_URL }}
      API_HEALTH_URL: ${{ vars.AUTOTESTER_STAGING_API_HEALTH_URL }}
      AUTOTESTER_API_URL: ${{ vars.AUTOTESTER_API_URL }}
      AUTOTESTER_API_KEY: ${{ secrets.AUTOTESTER_API_KEY }}
      RUN_TAG: gh-${{ github.run_number }}
      TRIGGER: ${{ github.event_name == 'schedule' && 'nightly' || github.event_name == 'pull_request' && 'pull_request' || github.event_name == 'push' && 'push' || inputs.trigger || 'manual' }}
    steps:
      - name: Checkout
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - name: Set up Node
        uses: actions/setup-node@<PIN-TO-A-COMMIT-SHA> # v4 — see "Pinning actions"
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: e2e/package-lock.json

      - name: Install (lockfile, no install scripts — PRD §5)
        run: npm ci --ignore-scripts

      - name: Install Chromium
        run: npx playwright install --with-deps chromium

      - name: Health check (FR-7)
        id: health
        run: node scripts/health-check.mjs

      - name: Register run as Running
        id: start
        if: env.AUTOTESTER_API_KEY != ''
        run: node scripts/start-run.mjs

      - name: Run smoke tests
        if: steps.health.outputs.up == 'true'
        env:
          USER_A_EMAIL: ${{ secrets.AUTOTESTER_USER_A_EMAIL }}
          USER_A_PASSWORD: ${{ secrets.AUTOTESTER_USER_A_PASSWORD }}
          USER_A_NAME: ${{ vars.AUTOTESTER_USER_A_NAME }}
          USER_B_EMAIL: ${{ secrets.AUTOTESTER_USER_B_EMAIL }}
          USER_B_PASSWORD: ${{ secrets.AUTOTESTER_USER_B_PASSWORD }}
          USER_B_NAME: ${{ vars.AUTOTESTER_USER_B_NAME }}
          TAG: ${{ inputs.tag }}
        run: |
          if [ -n "$TAG" ]; then
            npx playwright test --project=chromium --grep "$TAG"
          else
            npx playwright test --project=chromium
          fi

      - name: Post results (FR-15)
        if: always() && env.AUTOTESTER_API_KEY != ''
        env:
          AUTOTESTER_RUN_ID: ${{ steps.start.outputs.run_id }}
          ENV_DOWN: ${{ steps.health.outputs.up != 'true' }}
        run: node scripts/post-results.mjs

      - name: Upload traces and screenshots
        if: always()
        uses: actions/upload-artifact@<PIN-TO-A-COMMIT-SHA> # v4
        with:
          name: playwright-evidence-${{ github.run_number }}
          path: |
            e2e/test-results
            e2e/report
          retention-days: 14
          if-no-files-found: ignore
```

**Pinning actions** (NFR Supply chain): replace each `<PIN-TO-A-COMMIT-SHA>`
with the commit the `v4` tag points at:

```bash
gh api repos/actions/setup-node/git/ref/tags/v4 --jq .object.sha
gh api repos/actions/upload-artifact/git/ref/tags/v4 --jq .object.sha
```

(If `.object.type` is `tag` rather than `commit`, open the tag on GitHub and
copy the commit it dereferences to.)

**GitHub configuration** (repo → Settings → Environments → `staging`):

| Kind     | Name                                                    | Value                             |
| -------- | ------------------------------------------------------- | --------------------------------- |
| Variable | `AUTOTESTER_API_URL`                                    | `https://tester.zedu.chat`        |
| Variable | `AUTOTESTER_STAGING_URL`                                | `https://staging.zedu.chat`       |
| Variable | `AUTOTESTER_STAGING_API_HEALTH_URL`                     | staging API health URL (optional) |
| Variable | `AUTOTESTER_USER_A_NAME`, `AUTOTESTER_USER_B_NAME`      | display names of the test users   |
| Secret   | `AUTOTESTER_API_KEY`                                    | the key from Connect project      |
| Secret   | `AUTOTESTER_USER_A_EMAIL`, `AUTOTESTER_USER_A_PASSWORD` | test account A (staging only)     |
| Secret   | `AUTOTESTER_USER_B_EMAIL`, `AUTOTESTER_USER_B_PASSWORD` | test account B (staging only)     |

Backend (Coolify) additions: `DASHBOARD_URL`, `STAGING_ALLOWLIST`,
`ALLOWED_EMAIL_DOMAINS`, `ALERT_WEBHOOK_URL`, `GITHUB_TOKEN`, `RUNNER_REPO`.

---

## Part 4 — Docs to update

- `README.md`: under "Run locally" add the `e2e/` commands from 3.1 and 3.7; add an "Environment variables" table from 1.9 and 2.12; mention `docs/IMPLEMENTATION.md`.
- `docs/SETUP.md` step 3.5: `frontend/.env.example` now exists. Add step 6 "Set up the runner": create the `staging` environment, add the variables and secrets above, push, open Actions → Auto Tester smoke run → Run workflow.
- `examples/auto-tester-workflow.yml` is the FR-13 copy for Zedu's own repos. Replace its contents with `smoke.yml` once that works, with `working-directory` removed and the `e2e/` suite vendored or referenced.

---

## Part 5 — Order of work and demo checklist

**Today (Sat 17 Oct, Day 3)**

1. Frontend fixes with no backend change: 2.3 proxy route, 2.11 login error, 2.5 format.ts. Verify the dashboard still loads.
2. Backend: 1.1 migration, then 1.2 → 1.8 in that order (config, models, auth, alerts, github, store, router). Run the curl checks in 1.10 in dev mode. Restart with Supabase on and repeat steps 1 and 2 of the curl list.
3. Frontend features: 2.2 types, 2.4 api, 2.6 navbar, 2.7 dialog, 2.8 dashboard, 2.9 run page, 2.10 tests page. Connect the Zedu project through the dialog and store the key in GitHub.
4. Runner: 3.1 → 3.6, then only `login.spec.ts`. Confirm selectors with codegen on staging. One local passing run.
5. Workflow 3.9. Push to a branch, open a PR: the malware gate and the smoke run both execute. Watch the dashboard show Running, then a verdict.

**Tomorrow (Sun 18 Oct, Day 4, code freeze midday)**

6. Remaining specs from 3.7 as the squads confirm selectors. Target 12 P0 tests green.
7. Alerts: get the Zedu webhook URL and channel from the leads, set `ALERT_WEBHOOK_URL`, trigger one deliberate failure (e.g. temporarily set `enabled: false` on nothing and break one expected text), confirm the message arrives with the run link.
8. Rehearse the demo: Run now from GitHub → Running on the dashboard → Not Ready with screenshot → Copy bug report → Block with comment → fix → Re-run → Ready → Approve.
9. README and SETUP updates from Part 4. A teammate who did not build it follows SETUP.md alone.

**Acceptance criteria mapping (PRD §7.2)**

| Criterion                                        | Covered by                                                   |
| ------------------------------------------------ | ------------------------------------------------------------ |
| Run from dashboard, on demand, nightly           | Re-run button (FR-14), `workflow_dispatch`, `schedule`       |
| Exactly one verdict per run                      | `verdict.py` + Running → finished flow                       |
| Failed test shows name, step, screenshot, reason | run page + `post-results.mjs` attachments                    |
| Zedu message on every Not Ready                  | `alerts.py`                                                  |
| Set up from README alone                         | Part 4                                                       |
| 12+ P0 tests                                     | 3.7 plus squad specs; manifest tracks them                   |
| No credentials in the repo                       | env vars, GitHub environment secrets, `.gitignore`d `.auth/` |
