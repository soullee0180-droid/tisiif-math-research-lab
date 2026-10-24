"""Read-only response contracts. Extra columns remain visible, with stable core fields typed."""
from datetime import datetime
from typing import Any
from uuid import UUID
from pydantic import BaseModel,ConfigDict
class DTO(BaseModel):
    model_config=ConfigDict(extra='allow')
class PaperDTO(DTO):
    id:UUID
    code:str
    title:str
    workspace_id:UUID
    created_at:datetime
    preparation_status:str
class PaperListDTO(DTO):
    items:list[PaperDTO]
    total:int
    next_cursor:str|None
class PlanCreatedDTO(DTO):
    plan_id:UUID
    run_count:int
    logical_job_count:int
    state:str
    frozen_sha256:str
class MetricDTO(DTO):
    value:float|None
    eligible_runs:int
    total_runs:int
    papers:int
    excluded_runs:int
class SummaryDTO(DTO):
    groups:list[dict[str,Any]]
    selected_group:str|None
    comparison:str
    summary:dict[str,dict[str,MetricDTO]]
    eligibility:list[dict[str,Any]]
    run_count:int
    analysis_hash:str
