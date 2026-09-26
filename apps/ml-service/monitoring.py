"""
Error tracking (Sentry) for the ML service. Off unless SENTRY_DSN is set, so
local runs and the pytest suite never send anything anywhere.

This service receives raw vitals and contextual profiles. An error event must
never carry them: request bodies, headers, cookies, query strings and local
variables in stack frames (which, in engine.py, *are* the patient's readings)
are all disabled at the SDK level and stripped again in scrub_event.
"""
import os

SAFE_HEADERS = {"user-agent", "content-type", "x-request-id"}

_enabled = False


def scrub_event(event, _hint=None):
    request = event.get("request")
    if isinstance(request, dict):
        for key in ("data", "cookies", "query_string", "env"):
            request.pop(key, None)
        if isinstance(request.get("url"), str):
            request["url"] = request["url"].split("?")[0]
        headers = request.get("headers")
        if isinstance(headers, dict):
            request["headers"] = {k: v for k, v in headers.items() if k.lower() in SAFE_HEADERS}
    user = event.get("user")
    if isinstance(user, dict):
        event["user"] = {"id": user["id"]} if "id" in user else {}
    event.pop("extra", None)
    for exc in (event.get("exception") or {}).get("values") or []:
        for frame in (exc.get("stacktrace") or {}).get("frames") or []:
            frame.pop("vars", None)
    crumbs = event.get("breadcrumbs")
    if isinstance(crumbs, dict) and isinstance(crumbs.get("values"), list):
        crumbs["values"] = [
            {k: c.get(k) for k in ("category", "level", "timestamp", "type")} for c in crumbs["values"]
        ]
    return event


def init_monitoring(service: str = "ml-service") -> bool:
    global _enabled
    dsn = os.getenv("SENTRY_DSN", "").strip()
    if not dsn or _enabled:
        return _enabled
    import sentry_sdk
    from sentry_sdk.integrations.logging import LoggingIntegration

    sentry_sdk.init(
        dsn=dsn,
        environment=os.getenv("SENTRY_ENVIRONMENT") or os.getenv("RAILWAY_ENVIRONMENT_NAME") or "development",
        release=os.getenv("RAILWAY_GIT_COMMIT_SHA") or None,
        server_name=service,
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
        # Errors only; tracing is a separate decision (cost + another PHI surface).
        traces_sample_rate=0,
        # Log lines can include readings; don't turn them into breadcrumbs/events.
        integrations=[LoggingIntegration(level=None, event_level=None)],
        before_send=scrub_event,
        before_breadcrumb=lambda crumb, _hint: None if crumb.get("category") in ("console", "print") else crumb,
    )
    _enabled = True
    print(f"[monitoring] Sentry error tracking enabled for {service}")
    return True
