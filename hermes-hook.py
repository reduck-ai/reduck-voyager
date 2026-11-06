"""Hermes `post_api_request` shell hook: append one line per main-loop API call to the file named
by argv[1], with the token buckets Hermes normalized from the provider's usage.

The session database keeps only per-session totals, so this is where `hermes-session.ts` reads
what each call had in its context. Hermes sends the payload on stdin and ignores what an observer
hook prints; it prints nothing.
"""
import json
import sys

payload = json.load(sys.stdin)
data = payload.get("extra") if isinstance(payload.get("extra"), dict) else payload
row = {
    "session_id": data.get("session_id") or payload.get("session_id"),
    "api_call_count": data.get("api_call_count"),
    "model": data.get("response_model") or data.get("model"),
    "started_at": data.get("started_at"),
    "ended_at": data.get("ended_at"),
    "finish_reason": data.get("finish_reason"),
    "usage": data.get("usage"),
}
with open(sys.argv[1], "a", encoding="utf-8") as out:
    out.write(json.dumps(row) + "\n")
