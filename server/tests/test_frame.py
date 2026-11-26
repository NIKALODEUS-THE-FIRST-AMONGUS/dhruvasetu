"""Tests of the report format, its authentication tag and the seawater formulas."""
import unittest

from dhruvasetu import frame, seawater
from dhruvasetu.cmac import aes128_encrypt_block, aes_cmac

KEY = bytes.fromhex("2b7e151628aed2a6abf7158809cf4f3c")
RFC_MESSAGE = bytes.fromhex(
    "6bc1bee22e409f96e93d7e117393172a" "ae2d8a571e03ac9c9eb76fac45af8e51"
    "30c81c46a35ce411e5fbc1191a0a52ef" "f69f2445df4f9b17ad2b417be66c3710"
)
SAMPLE = {
    "type": "report", "buoy": 1, "seq": 1284, "time": 1795676400,
    "lat": -68.6867, "lon": 76.875,
    "water_temp_c": -1.2, "conductivity_ms_cm": 27.44, "wave_hs_m": 2.4, "wave_tp_s": 9.8,
    "noise_low_db": 6.0, "noise_mid_db": 2.0, "noise_high_db": -1.5,
    "air_pressure_hpa": 987.4, "air_temp_c": -8.3, "humidity_pct": 78.0, "hull_temp_c": -3,
    "battery_v": 3.92, "energy_j": 1.83, "tilt_deg": 4.5, "ice_timer_pct": 0,
    "state": "NORMAL", "position_valid": True, "time_valid": True, "backlog": 0,
}


class AesTests(unittest.TestCase):
    def test_fips_197_block(self):
        cipher = aes128_encrypt_block(bytes(range(16)), bytes.fromhex("00112233445566778899aabbccddeeff"))
        self.assertEqual(cipher.hex(), "69c4e0d86a7b0430d8cdb78070b4c55a")

    def test_rfc_4493_vectors(self):
        expected = {
            0: "bb1d6929e95937287fa37d129b756746",
            16: "070a16b46b4d4144f79bdd9dd04a287c",
            40: "dfa66747de9ae63030ca32611497c827",
            64: "51f0bebf7e3b9d92fc49741779363cfe",
        }
        for length, tag in expected.items():
            self.assertEqual(aes_cmac(KEY, RFC_MESSAGE[:length]).hex(), tag, f"length {length}")


class FrameTests(unittest.TestCase):
    def test_size_is_one_satellite_credit(self):
        self.assertEqual(len(frame.encode(SAMPLE, KEY)), 50)

    def test_round_trip(self):
        decoded = frame.decode(frame.encode(SAMPLE, KEY), KEY)
        self.assertTrue(decoded["tag_ok"])
        for name, value in SAMPLE.items():
            if isinstance(value, float):
                self.assertAlmostEqual(decoded[name], value, places=6, msg=name)
            else:
                self.assertEqual(decoded[name], value, name)
        self.assertFalse(decoded["leak"])

    def test_missing_values_come_back_as_none(self):
        report = dict(SAMPLE, lat=None, lon=None, wave_hs_m=None, time=None, position_valid=False, time_valid=False)
        decoded = frame.decode(frame.encode(report, KEY), KEY)
        for name in ("lat", "lon", "wave_hs_m", "time"):
            self.assertIsNone(decoded[name], name)

    def test_state_and_flags(self):
        report = dict(SAMPLE, state="ICE", leak=True, bench_timing=True, recovered=True, backlog=412)
        decoded = frame.decode(frame.encode(report, KEY), KEY)
        self.assertEqual(decoded["state"], "ICE")
        self.assertTrue(decoded["leak"] and decoded["bench_timing"] and decoded["recovered"])
        self.assertFalse(decoded["low_battery"])
        self.assertEqual(decoded["backlog"], 412)

    def test_a_changed_byte_fails_the_tag(self):
        packed = bytearray(frame.encode(SAMPLE, KEY))
        packed[16] ^= 0x01
        self.assertFalse(frame.decode(bytes(packed), KEY)["tag_ok"])
        self.assertFalse(frame.decode(frame.encode(SAMPLE, KEY), bytes(16))["tag_ok"])

    def test_out_of_range_is_refused(self):
        with self.assertRaises(ValueError):
            frame.encode(dict(SAMPLE, water_temp_c=400.0), KEY)
        with self.assertRaises(ValueError):
            frame.decode(b"\x00" * 49, KEY)


class SeawaterTests(unittest.TestCase):
    def test_standard_seawater_is_35(self):
        self.assertAlmostEqual(seawater.salinity(seawater.C_35_15, 15.0), 35.0, places=4)

    def test_conductivity_is_the_inverse(self):
        value = seawater.conductivity(34.1, -1.2)
        self.assertAlmostEqual(seawater.salinity(value, -1.2), 34.1, places=6)
        self.assertTrue(26.0 < value < 29.0)

    def test_freezing_point(self):
        self.assertAlmostEqual(seawater.freezing_point(35.0), -1.922, places=2)
        self.assertEqual(seawater.freezing_point(0.0), 0.0)

    def test_airtime(self):
        self.assertAlmostEqual(seawater.lora_airtime_ms(48, 9), 308, delta=1)
        self.assertAlmostEqual(seawater.lora_airtime_ms(48, 12), 2302, delta=1)


if __name__ == "__main__":
    unittest.main()
