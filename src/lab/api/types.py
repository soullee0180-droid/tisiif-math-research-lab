from typing import Any, Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator

class Body(BaseModel):
    model_config = ConfigDict(extra="forbid")

class FileSpec(Body):
    client_file_id: UUID
    name: str = Field(min_length=1, max_length=255)
    byte_size: int = Field(gt=0, le=104857600)
    mime_type: Literal["application/pdf"] = "application/pdf"

class ReserveBody(Body):
    files: list[FileSpec] = Field(min_length=1, max_length=100)
    @model_validator(mode="after")
    def total(self):
        if sum(f.byte_size for f in self.files) > 1073741824: raise ValueError("BATCH_TOO_LARGE")
        return self

class RevisionPatch(Body):
    title: str = Field(default="", max_length=300)
    expected_hash: str
    input_mode: Literal["pdf", "text"]
    goal_md: str = ""
    obstacle_md: str = ""
    abstract_md: str = ""
    public_text_md: str = ""
    reference_idea_md: str = ""
    reference_location: str = ""
    stage_outline: list[dict[str, Any]] = []
    page_recipe: list[dict[str, Any]] = []
    review_note: str = ""

class CheckpointBody(Body):
    title: str = Field(min_length=1, max_length=300)

class CloneBody(Body):
    source_revision_id: UUID

class ApproveBody(Body):
    reviewed_hash: str
    public_input_checked: Literal[True]
    hidden_content_checked: Literal[True]
    reference_checked: Literal[True]

class Schedule(Body):
    mode: Literal["now", "scheduled"] = "now"
    local_datetime: str | None = None
    timezone: Literal["Asia/Seoul"] = "Asia/Seoul"

class PlanBody(Body):
    title: str = Field(min_length=1, max_length=300)
    cohort: Literal["pilot", "main", "manual", "fixture", "diagnostic"] = "pilot"
    transport: Literal["api", "manual", "mock"] = "api"
    checkpoint_revision_ids: list[UUID] = Field(min_length=1, max_length=200)
    protocol_id: UUID
    generator_profile_ids: dict[str, UUID] = {}
    schedule: Schedule = Schedule()
    preflight_hash: str | None = None

class RetryBody(Body):
    reason: str = Field(min_length=1, max_length=1000)
    acknowledge_duplicate_risk: bool = False

class ManualBody(Body):
    raw_text: str = Field(min_length=1)
    screen_model: str
    mode: str = ""
    occurred_at: str
    tools: Literal["on", "off", "unknown"] = "unknown"
    web_search: Literal["on", "off", "unknown"] = "unknown"
    memory: Literal["on", "off", "unknown"] = "unknown"
    conversation_url: str | None = None
    mapped_response: dict[str, Any] | None = None
    correction_reason: str | None = None

class ExportBody(Body):
    kind: Literal["xlsx", "research_zip", "external_zip"]
    filters: dict[str, Any]
    include_source: bool = True

class ReviewBatchBody(Body):
    plan_ids: list[UUID] = Field(min_length=1)
    reviewer_ids: list[UUID] = Field(min_length=1, max_length=3)
    seed: str = "20261023"
    per_stratum: int = Field(default=5, ge=1, le=30)

class ReviewSubmit(Body):
    phase: Literal["usefulness", "agreement"]
    score: int | None = Field(default=None, ge=0, le=4)
    validity: Literal["supported", "promising_unverified", "error_identified", "undetermined"] | None = None
    agreement_label: Literal["none", "partial", "core", "undetermined"] | None = None
    rationale_md: str = Field(min_length=1)
    unable_reason: str | None = None
    expected_revision_no: int = Field(ge=0)
    correction_reason: str | None = None

class KeyBody(Body):
    key: str = Field(min_length=1, max_length=2048)

class ProfileBody(Body):
    provider: Literal["google", "openai", "anthropic"]
    label: str = Field(min_length=1)
    model_id: str = Field(min_length=1)
    config: dict[str, Any]
    capabilities: dict[str, Any]
    manual_only: bool = False

class RuntimeBody(Body):
    enabled: bool
    max_concurrency: int = Field(ge=1, le=4)
    min_interval_seconds: int = Field(ge=0)
    rpm_limit: int | None = Field(default=None, gt=0)
    tpm_limit: int | None = Field(default=None, gt=0)
    clear_block: bool = False
    eligibility_confirmed: bool | None = None

class MemberBody(Body):
    email: str
    role: Literal["admin", "researcher"]
    active: bool

class ProtocolBody(Body):
    name: str
    definition: dict[str, Any]
    change_reason: str = Field(min_length=1)

class TestBody(Body):
    profile_id: UUID
    allow_one_paid_request: Literal[True]

class PaperPatch(Body):
    expected_hash: str
    title: str
    authors: str = ""
    source_url: str | None = None
    doi_or_arxiv: str | None = None
    paper_version: str | None = None
    published_date: str | None = None
    subject: str = ""
    rights_status: Literal["unrecorded", "license_recorded", "permission_recorded", "team_review_recorded"] = "unrecorded"
    rights_note: str = ""

class BackupBody(Body):
    include_source: bool = True

class RestoreBody(Body):
    asset_id: UUID
    expected_manifest_hash: str | None = None

