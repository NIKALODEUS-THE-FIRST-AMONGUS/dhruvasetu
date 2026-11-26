"""Ask the project's database whether its stream is alive.

    python tools/check_stream.py

It asks for the newest report with the publishable key, as a page does, and fails when
there is none or when it is older than a minute and a half. GitHub runs it four times a
day: a failure there means the made-up buoy has stopped or the project has been paused.
Asking also counts as use, and a free Supabase project that is not used for a week is paused.
"""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = json.loads((ROOT / "web" / "src" / "data" / "backend.json").read_text(encoding="utf-8"))
OLDEST_S = 90


def main() -> int:
    request = urllib.request.Request(
        BACKEND["url"] + "/rest/v1/rpc/stream",
        data=json.dumps({"p_buoy": BACKEND["buoy"], "p_limit": 1}).encode("utf-8"),
        headers={"apikey": BACKEND["key"], "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        answer = json.load(response)
    if not answer.get("reports"):
        print("The database answers, but holds no report.")
        return 1
    newest = answer["reports"][-1]
    age_s = (answer["now_ms"] - newest["received_ms"]) / 1000
    link = answer.get("link") or {}
    print(
        f"{answer['source']} buoy {answer['buoy']['name']}: report {newest['report']['seq']} is {age_s:.0f} s old; "
        f"{link.get('received_total')} stored, {link.get('lost_total')} missing, {link.get('refused_total')} refused."
    )
    if age_s > OLDEST_S:
        print(f"That is older than {OLDEST_S} s: the stream has stopped.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
