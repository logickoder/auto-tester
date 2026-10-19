"""Unit tests for the verdict rules (PRD FR-17). Run: python -m unittest"""
import unittest

from app.verdict import compute_verdict, summarise


def t(priority: str, status: str) -> dict:
    return {"priority": priority, "status": status}


class ComputeVerdictTest(unittest.TestCase):
    def test_all_passed_is_ready(self):
        tests = [t("P0", "passed"), t("P1", "passed"), t("P2", "passed")]
        self.assertEqual(compute_verdict("completed", tests), "ready")

    def test_running_run_is_running(self):
        # Even with a failed P0, an in-progress run has no final verdict yet.
        self.assertEqual(compute_verdict("running", [t("P0", "failed")]), "running")

    def test_runner_error_is_not_ready(self):
        # A crashed runner blocks the release even if every test passed.
        self.assertEqual(compute_verdict("error", [t("P0", "passed")]), "not_ready")

    def test_p0_failure_is_not_ready(self):
        for status in ("failed", "error", "skipped"):
            with self.subTest(status=status):
                tests = [t("P0", "passed"), t("P0", status)]
                self.assertEqual(compute_verdict("completed", tests), "not_ready")

    def test_p0_failure_beats_p1_failure(self):
        tests = [t("P0", "failed"), t("P1", "failed")]
        self.assertEqual(compute_verdict("completed", tests), "not_ready")

    def test_p1_failure_is_ready_with_warnings(self):
        for status in ("failed", "error"):
            with self.subTest(status=status):
                tests = [t("P0", "passed"), t("P1", status)]
                self.assertEqual(compute_verdict("completed", tests), "ready_with_warnings")

    def test_flaky_test_is_ready_with_warnings(self):
        tests = [t("P0", "flaky"), t("P1", "passed")]
        self.assertEqual(compute_verdict("completed", tests), "ready_with_warnings")

    def test_skipped_p1_is_ready(self):
        # Only a skipped P0 blocks the release; a skipped P1 does not warn.
        tests = [t("P0", "passed"), t("P1", "skipped")]
        self.assertEqual(compute_verdict("completed", tests), "ready")

    def test_p2_failure_is_ready(self):
        # P2 tests are informational and never change the verdict.
        tests = [t("P0", "passed"), t("P2", "failed")]
        self.assertEqual(compute_verdict("completed", tests), "ready")

    def test_no_tests_is_ready(self):
        self.assertEqual(compute_verdict("completed", []), "ready")


class SummariseTest(unittest.TestCase):
    def test_counts_each_status(self):
        tests = [
            t("P0", "passed"),
            t("P0", "passed"),
            t("P0", "failed"),
            t("P1", "error"),
            t("P1", "flaky"),
            t("P2", "skipped"),
        ]
        self.assertEqual(
            summarise(tests),
            {"total": 6, "passed": 2, "failed": 2, "flaky": 1, "skipped": 1},
        )

    def test_empty(self):
        self.assertEqual(
            summarise([]),
            {"total": 0, "passed": 0, "failed": 0, "flaky": 0, "skipped": 0},
        )


if __name__ == "__main__":
    unittest.main()
