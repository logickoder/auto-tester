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
