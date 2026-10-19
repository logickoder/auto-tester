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
