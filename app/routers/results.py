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
