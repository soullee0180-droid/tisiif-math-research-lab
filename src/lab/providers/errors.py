from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

@dataclass
class ProviderFailure(Exception):
    error_class: str
    message: str
    http_status: int | None = None
    retry_after: int | None = None
    remote_uncertain: bool = False

def classify(status, body, headers=None):
    headers = headers or {}
    text = str(body).lower()
    retry = headers.get("retry-after")
    seconds = None
    if retry:
        try: seconds = max(0, int(retry))
        except ValueError:
            try: seconds = max(0, int((parsedate_to_datetime(retry) - datetime.now(timezone.utc)).total_seconds()))
            except (ValueError, TypeError): pass
    if status == 401: kind = "credential_blocked"
    elif status == 402: kind = "payment_blocked"
    elif status == 403: kind = "permission_blocked"
    elif status == 413: kind = "input_size"
    elif status in (400, 404): kind = "model_or_input"
    elif status == 429:
        if any(x in text for x in ("billing", "spend", "credit", "insufficient_quota", "payment")): kind = "spend_blocked"
        elif any(x in text for x in ("per_day", "per day", "daily", "requestsperday")): kind = "quota_daily"
        elif any(x in text for x in ("per_minute", "per minute", "rate_limit", "tokensperminute", "requestsperminute")) or seconds is not None: kind = "rate_transient"
        else: kind = "quota_unknown"
    else: kind = "remote_unknown"  # An ambiguous 5xx must not cause a duplicate request.
    return ProviderFailure(kind, "제공사 요청을 완료하지 못했습니다.", status, seconds,
                           kind == "remote_unknown")

