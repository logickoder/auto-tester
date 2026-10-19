"""Verdict logic — PRD FR-17.

Ready              every P0 test passed
Ready with warnings only P1 tests failed, or a test was flaky
Not Ready          any P0 failure, skipped P0, or a runner error
Running            while the run is still in progress
"""


def compute_verdict(run_status: str, tests: list[dict]) -> str:
    if run_status == "running":
        return "running"
    if run_status == "error":
        return "not_ready"  # runner error blocks the release

    p0_bad = any(
        t["priority"] == "P0" and t["status"] in ("failed", "error", "skipped") for t in tests
    )
    if p0_bad:
        return "not_ready"

    p1_bad = any(t["priority"] == "P1" and t["status"] in ("failed", "error") for t in tests)
    flaky = any(t["status"] == "flaky" for t in tests)
    if p1_bad or flaky:
        return "ready_with_warnings"

    return "ready"


def summarise(tests: list[dict]) -> dict:
    return {
        "total": len(tests),
        "passed": sum(1 for t in tests if t["status"] == "passed"),
        "failed": sum(1 for t in tests if t["status"] in ("failed", "error")),
        "flaky": sum(1 for t in tests if t["status"] == "flaky"),
        "skipped": sum(1 for t in tests if t["status"] == "skipped"),
    }
