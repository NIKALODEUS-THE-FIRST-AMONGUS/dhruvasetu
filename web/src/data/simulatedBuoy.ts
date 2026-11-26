/** Stands in for the buoy until hardware exists.
 *
 *  A real buoy answers "check yourself" with the results of its built-in tests. No firmware
 *  is written yet, so these answers are made up from the report in hand. The page uses this
 *  module only when the session is simulated or replayed, and says so beside every answer. */
import type { PartId } from '../lib/health'
import type { Report } from './types'

/** A fault to rehearse: what the page shows when a part stops working. */
export type Fault = 'none' | 'water_temp' | 'conductivity' | 'motion' | 'leak'

export const FAULTS: readonly { id: Fault; label: string }[] = [
  { id: 'none', label: 'No fault' },
  { id: 'water_temp', label: 'Water temperature probe unplugged' },
  { id: 'conductivity', label: 'Conductivity cell out of the water' },
  { id: 'motion', label: 'Motion sensor not answering' },
  { id: 'leak', label: 'Water inside the hull' },
]

export function isFault(value: string | null): value is Fault {
  return FAULTS.some((fault) => fault.id === value)
}

/** The report as the buoy would send it with the fault present. */
export function withFault(report: Report, fault: Fault): Report {
  switch (fault) {
    case 'water_temp':
      return { ...report, water_temp_c: null, salinity: null, freezing_point_c: null, conductivity_doubtful: true }
    case 'conductivity':
      return { ...report, conductivity_ms_cm: 0.004, salinity: null, freezing_point_c: null, conductivity_doubtful: true }
    case 'motion':
      return { ...report, wave_hs_m: null, wave_tp_s: null, tilt_deg: null }
    case 'leak':
      return { ...report, leak: true }
    default:
      return report
  }
}

export interface SelfTest {
  passed: boolean
  /** What the buoy measured while testing itself. */
  detail: string
}

const ADC_FULL = 4095

/** Counts a 12-bit converter reads on a 10 kΩ thermistor (B = 3950) under a 10 kΩ resistor. */
function thermistorCounts(celsius: number): number {
  const resistance = 10_000 * Math.exp(3950 * (1 / (celsius + 273.15) - 1 / 298.15))
  return Math.round((ADC_FULL * resistance) / (resistance + 10_000))
}

/** The answer of the made-up buoy to "check this part". */
export function selfTest(part: PartId, report: Report, fault: Fault): SelfTest {
  const volts = report.battery_v ?? 0
  switch (part) {
    case 'water_temp':
      return fault === 'water_temp'
        ? { passed: false, detail: `Input reads ${ADC_FULL} of ${ADC_FULL} counts: open circuit, no probe connected.` }
        : { passed: true, detail: `Input reads ${thermistorCounts(report.water_temp_c ?? 20)} of ${ADC_FULL} counts: a probe is connected, not open, not shorted.` }
    case 'conductivity':
      return fault === 'conductivity'
        ? { passed: false, detail: 'No current flows in either direction: the cell is dry or out of the water.' }
        : { passed: true, detail: 'Current flows the same in both directions, within 1 %.' }
    case 'motion':
      return fault === 'motion'
        ? { passed: false, detail: 'No answer at address 0x68 on the sensor bus.' }
        : { passed: true, detail: 'Answers as an MPU6050; its built-in test is within limits; gravity reads 0.998 g.' }
    case 'leak':
      return fault === 'leak'
        ? { passed: false, detail: 'The probe itself reads wet.' }
        : { passed: true, detail: 'The test resistor reads as wet and the probe reads as dry: the alarm path works.' }
    case 'noise':
      return { passed: true, detail: 'The amplifier rests at 1.65 V; a test pulse rings in the disc for 3.1 ms.' }
    case 'air':
      return { passed: true, detail: 'Answers as a BME280; pressure, temperature and humidity are in range.' }
    case 'gnss':
      return report.position_valid
        ? { passed: true, detail: 'Sentences arrive every second; 9 satellites in use.' }
        : { passed: false, detail: 'Sentences arrive, but no satellite is in use.' }
    case 'radio':
      return { passed: true, detail: 'The radio answers on its bus; the last transmission completed.' }
    case 'battery':
      return { passed: volts >= 3.0, detail: `${volts.toFixed(2)} V at rest, ${(volts - 0.04).toFixed(2)} V while the radio transmits.` }
    case 'power':
      return { passed: true, detail: 'The monitor answers as an INA226; the 3.3 V rail reads 3.29 V.' }
    case 'computer':
      return { passed: true, detail: 'Running since power-on, no restart; the report store is 2 % full; firmware 0.1.' }
    case 'oxygen':
      return { passed: false, detail: 'Not fitted.' }
  }
}
