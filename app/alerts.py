"""FR-24: tell the team when a run fails. Outbound webhook only.

One JSON POST to ALERT_WEBHOOK_URL when a run reaches a final verdict of
Not Ready (and on success when ALERT_ON_SUCCESS=true). The payload carries a
plain "text" field, which Slack- and Mattermost-style incoming webhooks accept
as-is, plus structured fields for a Zedu bot. Sending runs on a background
thread so the runner's request never waits, and a dead webhook never fails a
run.
"""
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
