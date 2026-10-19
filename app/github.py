"""FR-14: "Re-run" — start the smoke workflow again via GitHub workflow_dispatch.

GITHUB_TOKEN is a fine-grained PAT with Actions: read and write on the runner
repo only. It lives on the API (Coolify env), never in the frontend.
RUNNER_REPO ("owner/repo") names the repo that holds smoke.yml; without it
the project's repo_url is used (FR-13: workflow copied into Zedu's own repo).
"""
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
