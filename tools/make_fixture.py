"""Write web/src/fixtures/session.json: twenty made-up minutes off Prydz Bay.

Every report goes through the real encoder and decoder, so the page is fed exactly
what the server will send. The numbers are invented and the page labels them so.

    python tools/make_fixture.py
"""
from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from dhruvasetu import frame, seawater  # noqa: E402

KEY = bytes.fromhex("000102030405060708090a0b0c0d0e0f")      # demo key, published on purpose
INTERVAL_S = 10
COUNT = 120
FIRST_SEQ = 1165
LAST_TIME = 1795676400                                       # 2026-11-26 07:00:00 UTC
LOST = {1231, 1232}
SPREADING_FACTOR = 9


def main() -> None:
    rng = random.Random(26065)
    lat, lon = -68.6880, 76.8700
    reports = []
    for index in range(COUNT):
        seq = FIRST_SEQ + index
        minutes = index * INTERVAL_S / 60
        lat += (0.8 + rng.gauss(0, 0.5)) / 111_320
        lon += (1.3 + rng.gauss(0, 0.6)) / (111_320 * math.cos(math.radians(lat)))
        water = -1.20 + 0.04 * math.sin(minutes / 7) + rng.gauss(0, 0.008)
        salt = 34.10 + 0.02 * math.sin(minutes / 11 + 1) + rng.gauss(0, 0.004)
        height = 2.30 + 0.10 * math.sin(minutes / 25) + rng.gauss(0, 0.02)
        measured = {
            "type": "report", "buoy": 1, "seq": seq,
            "time": LAST_TIME - (COUNT - 1 - index) * INTERVAL_S,
            "lat": lat, "lon": lon,
            "water_temp_c": water,
            "conductivity_ms_cm": seawater.conductivity(salt, water),
            "wave_hs_m": height,
            "wave_tp_s": 9.8 + 0.3 * math.sin(minutes / 6) + rng.gauss(0, 0.05),
            "noise_low_db": 6.0 + 2.5 * (height - 2.3) + rng.gauss(0, 0.4),
            "noise_mid_db": 2.0 + rng.gauss(0, 0.4),
            "noise_high_db": -1.0 + rng.gauss(0, 0.4),
            "air_pressure_hpa": 988.0 - 0.03 * minutes + rng.gauss(0, 0.03),
            "air_temp_c": -8.3 + 0.2 * math.sin(minutes / 9) + rng.gauss(0, 0.03),
            "humidity_pct": 78.0 + rng.gauss(0, 0.4),
            "hull_temp_c": -3,
            "battery_v": 3.921 - 0.00005 * minutes + rng.gauss(0, 0.0004),
            "energy_j": 0.42 + rng.gauss(0, 0.015),
            "tilt_deg": 4.5 + 1.5 * (height - 2.3) + rng.gauss(0, 0.3),
            "ice_timer_pct": 0,
            "state": "NORMAL", "position_valid": True, "time_valid": True, "backlog": 0,
        }
        rssi, snr = -104 + rng.gauss(0, 2.5), 5.5 + rng.gauss(0, 1.2)
        if seq in LOST:
            continue
        packed = frame.encode(measured, KEY)
        report = frame.decode(packed, KEY)
        salinity = seawater.salinity(report["conductivity_ms_cm"], report["water_temp_c"])
        report.update({
            "buoy_name": f"DS-{report['buoy']:02d}",
            "salinity": round(salinity, 2),
            "freezing_point_c": round(seawater.freezing_point(salinity), 2),
            "rssi_dbm": round(rssi),
            "snr_db": round(snr, 1),
            "raw": packed.hex(),
        })
        reports.append(report)
    session = {
        "source": "simulated",
        "scenario": "Prydz Bay, Southern Ocean",
        "note": "Simulated data. Not a measurement.",
        "interval_s": INTERVAL_S,
        "frame_bytes": frame.FRAME_BYTES,
        "airtime_ms": round(seawater.lora_airtime_ms(frame.FRAME_BYTES, SPREADING_FACTOR)),
        "spreading_factor": SPREADING_FACTOR,
        "received_total": 1278,
        "lost_total": 6,
        "now": LAST_TIME + 4,
        "reports": reports,
    }
    target = ROOT / "web" / "src" / "fixtures" / "session.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(session, separators=(",", ":")), encoding="utf-8", newline="\n")
    last = reports[-1]
    print(f"{len(reports)} reports -> {target} ({target.stat().st_size / 1000:.0f} kB)")
    print({key: last[key] for key in ("seq", "water_temp_c", "conductivity_ms_cm", "salinity", "freezing_point_c", "wave_hs_m", "air_pressure_hpa", "raw")})
    for factor in (7, 9, 10, 12):
        print(f"SF{factor}: {seawater.lora_airtime_ms(frame.FRAME_BYTES, factor):.0f} ms on air for {frame.FRAME_BYTES} bytes")


if __name__ == "__main__":
    main()
