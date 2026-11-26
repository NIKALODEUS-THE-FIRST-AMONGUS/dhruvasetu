"""The buoy's report: 42 bytes of measurements and an 8-byte authentication tag.

The layout is not written here. It is read from contract/report.v1.json, the one
definition shared by the buoy, the receiver, the server and the web page.
"""
from __future__ import annotations

import hmac
import json
import struct
from pathlib import Path
from typing import Any

from .cmac import aes_cmac

CONTRACT_PATH = Path(__file__).resolve().parents[2] / "contract" / "report.v1.json"
CONTRACT: dict[str, Any] = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

_STRUCT_CODES = {"u8": "B", "i8": "b", "u16": "H", "i16": "h", "u32": "I", "i32": "i"}
_RANGES = {
    "u8": (0, 0xFF), "i8": (-0x80, 0x7F), "u16": (0, 0xFFFF),
    "i16": (-0x8000, 0x7FFF), "u32": (0, 0xFFFFFFFF), "i32": (-0x80000000, 0x7FFFFFFF),
}
FIELDS: list[dict[str, Any]] = CONTRACT["fields"]
STATES: list[str] = CONTRACT["states"]
FLAG_BITS: dict[str, int] = CONTRACT["flag_bits"]
VERSION: int = CONTRACT["version"]
PAYLOAD_BYTES: int = CONTRACT["payload_bytes"]
TAG_BYTES: int = CONTRACT["tag_bytes"]
FRAME_BYTES = PAYLOAD_BYTES + TAG_BYTES
MESSAGE_TYPES = ["report"]

_PACKER = struct.Struct("<" + "".join(_STRUCT_CODES[field["type"]] for field in FIELDS))
if _PACKER.size != PAYLOAD_BYTES:
    raise RuntimeError(f"the contract lists {_PACKER.size} payload bytes, not {PAYLOAD_BYTES}")
_MEASURED = [field for field in FIELDS if field["name"] not in ("header", "buoy", "seq", "flags", "backlog")]


def _to_raw(field: dict[str, Any], value: float | None) -> int:
    low, high = _RANGES[field["type"]]
    if value is None:
        if "invalid" not in field:
            raise ValueError(f"{field['name']} is required")
        return int(field["invalid"])
    raw = round((value - field.get("offset", 0)) / field.get("scale", 1))
    if not low <= raw <= high or raw == field.get("invalid"):
        raise ValueError(f"{field['name']} = {value} does not fit a {field['type']}")
    return raw


def _from_raw(field: dict[str, Any], raw: int) -> float | int | None:
    if raw == field.get("invalid"):
        return None
    if "scale" not in field and "offset" not in field:
        return raw
    value = raw * field.get("scale", 1) + field.get("offset", 0)
    digits = max(0, len(f"{field.get('scale', 1):.7f}".rstrip("0").split(".")[1]))
    return round(value, digits)


def encode(report: dict[str, Any], key: bytes) -> bytes:
    """Pack a report into its 50 bytes. `key` is the buoy's 16-byte AES key."""
    flags = STATES.index(report["state"])
    for name, bit in FLAG_BITS.items():
        if report.get(name):
            flags |= 1 << bit
    values = {
        "header": (VERSION << 4) | MESSAGE_TYPES.index(report.get("type", "report")),
        "buoy": report["buoy"],
        "seq": report["seq"] & 0xFFFF,
        "flags": flags,
        "backlog": min(report.get("backlog", 0), 0xFFFF),
    }
    for field in _MEASURED:
        values[field["name"]] = _to_raw(field, report.get(field["name"]))
    payload = _PACKER.pack(*(values[field["name"]] for field in FIELDS))
    return payload + aes_cmac(key, payload)[:TAG_BYTES]


def decode(frame: bytes, key: bytes | None = None) -> dict[str, Any]:
    """Unpack 50 bytes. With a key, `tag_ok` says whether the tag is the buoy's."""
    if len(frame) != FRAME_BYTES:
        raise ValueError(f"a report is {FRAME_BYTES} bytes, not {len(frame)}")
    payload, tag = frame[:PAYLOAD_BYTES], frame[PAYLOAD_BYTES:]
    raw = dict(zip((field["name"] for field in FIELDS), _PACKER.unpack(payload)))
    version, kind = raw["header"] >> 4, raw["header"] & 0x0F
    if version != VERSION or kind >= len(MESSAGE_TYPES):
        raise ValueError(f"unknown format version {version} or message type {kind}")
    report: dict[str, Any] = {
        "version": version,
        "type": MESSAGE_TYPES[kind],
        "buoy": raw["buoy"],
        "seq": raw["seq"],
    }
    for field in _MEASURED:
        report[field["name"]] = _from_raw(field, raw[field["name"]])
    state_index = raw["flags"] & 0b11
    if state_index >= len(STATES):
        raise ValueError(f"unknown state {state_index}")
    report["state"] = STATES[state_index]
    for name, bit in FLAG_BITS.items():
        report[name] = bool(raw["flags"] >> bit & 1)
    report["backlog"] = raw["backlog"]
    report["tag_ok"] = None if key is None else hmac.compare_digest(aes_cmac(key, payload)[:TAG_BYTES], tag)
    return report
