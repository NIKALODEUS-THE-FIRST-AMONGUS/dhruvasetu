"""Seawater formulas the server and the made-up buoy need. Surface pressure only."""
from __future__ import annotations

import math

C_35_15 = 42.914          # mS/cm: conductivity of standard seawater, S = 35, 15 degC, surface
_A = (0.0080, -0.1692, 25.3851, 14.0941, -7.0261, 2.7081)
_B = (0.0005, -0.0056, -0.0066, -0.0375, 0.0636, -0.0144)
_C = (0.6766097, 2.00564e-2, 1.104259e-4, -6.9698e-7, 1.0031e-9)
_K = 0.0162


def salinity(conductivity_ms_cm: float, temperature_c: float) -> float:
    """Practical salinity (PSS-78) from conductivity and temperature. Valid for 2 to 42."""
    ratio = conductivity_ms_cm / C_35_15
    temperature_ratio = sum(coefficient * temperature_c ** power for power, coefficient in enumerate(_C))
    root = math.sqrt(max(ratio / temperature_ratio, 0.0))
    base = sum(coefficient * root ** power for power, coefficient in enumerate(_A))
    correction = sum(coefficient * root ** power for power, coefficient in enumerate(_B))
    delta = temperature_c - 15.0
    return base + delta / (1.0 + _K * delta) * correction


def conductivity(salinity_value: float, temperature_c: float) -> float:
    """Conductivity in mS/cm for a salinity and temperature: PSS-78 solved backwards."""
    low, high = 0.0, 90.0
    for _ in range(60):
        middle = (low + high) / 2
        if salinity(middle, temperature_c) < salinity_value:
            low = middle
        else:
            high = middle
    return (low + high) / 2


def freezing_point(salinity_value: float) -> float:
    """Freezing point of seawater at the surface, degC (UNESCO 1983)."""
    s = max(salinity_value, 0.0)
    return -0.0575 * s + 1.710523e-3 * s ** 1.5 - 2.154996e-4 * s ** 2


def lora_airtime_ms(payload_bytes: int, spreading_factor: int, bandwidth_hz: int = 125_000,
                    coding_rate: int = 1, preamble_symbols: int = 8) -> float:
    """Time on air of one LoRa packet with header and CRC (Semtech formula). coding_rate 1 is 4/5."""
    symbol_s = 2 ** spreading_factor / bandwidth_hz
    low_rate = 1 if symbol_s > 0.016 else 0
    numerator = 8 * payload_bytes - 4 * spreading_factor + 28 + 16
    payload_symbols = 8 + max(math.ceil(numerator / (4 * (spreading_factor - 2 * low_rate))) * (coding_rate + 4), 0)
    return 1000 * (preamble_symbols + 4.25 + payload_symbols) * symbol_s
