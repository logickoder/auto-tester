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
