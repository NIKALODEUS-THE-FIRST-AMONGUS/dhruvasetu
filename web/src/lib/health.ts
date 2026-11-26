import type { Quantity, Report, Session } from '../data/types'
import { fixed, latitude, longitude, thousands } from './format'

export type PartId =
  | 'water_temp' | 'conductivity' | 'noise' | 'oxygen' | 'leak' | 'motion'
  | 'gnss' | 'radio' | 'air' | 'battery' | 'power' | 'computer'

/** ok: every check passes. doubt: it reports, but something is off. fail: it does not do its job.
 *  absent: not fitted. silent: nothing heard from the buoy, so this is the last known state. */
export type Status = 'ok' | 'doubt' | 'fail' | 'absent' | 'silent'

export interface Part {
  id: PartId
  name: string
  what: string
  /** Where it sits on the section through hull H3: mm from the axis, mm above the keel plate. */
  x: number
  z: number
}

export const PARTS: readonly Part[] = [
  { id: 'radio', name: 'Radio', what: 'SX1262 LoRa, 865\u2013867 MHz, whip on the lid', x: 0, z: 392 },
  { id: 'gnss', name: 'Position', what: 'GNSS receiver, patch antenna under the lid', x: 22, z: 318 },
  { id: 'air', name: 'Air sensor', what: 'BME280 under the lid, behind the vent', x: -92, z: 262 },
  { id: 'computer', name: 'Computer', what: 'ESP32-S3 on the carrier, with the report store', x: 76, z: 170 },
  { id: 'motion', name: 'Motion sensor', what: 'MPU6050 on the carrier: waves and tilt', x: 76, z: 146 },
  { id: 'power', name: 'Power monitor', what: 'INA226 and the 3.3 V converter', x: 76, z: 114 },
  { id: 'battery', name: 'Battery', what: 'Two 18650 cells in parallel', x: -76, z: 126 },
  { id: 'leak', name: 'Leak probe', what: 'Two contacts at the lowest point inside', x: -84, z: 14 },
  { id: 'noise', name: 'Hydrophone', what: 'Piezo disc glued inside the sensor plate', x: 0, z: 16 },
  { id: 'water_temp', name: 'Water temperature', what: 'Thermistor in a steel tube through the keel', x: -25, z: -30 },
  { id: 'conductivity', name: 'Conductivity cell', what: 'Tube with two electrodes, printed into the sensor plate', x: 25, z: -20 },
  { id: 'oxygen', name: 'Dissolved oxygen', what: 'A costed option. Its port is blanked', x: 50, z: -3 },
]

export interface Check {
  label: string
  /** null: the check was not made, because what it needs was not sent. No value is not a pass. */
  passed: boolean | null
  /** What a failed check means for the part. */
  severity: 'doubt' | 'fail'
}

export interface PartHealth {
  part: Part
  status: Status
  /** One line for the list: the reading, or what is wrong. */
  summary: string
  readings: [string, string][]
  checks: Check[]
}

const STUCK_AFTER = 60

function unchanged(reports: readonly Report[], key: Quantity): boolean {
  const tail = reports.slice(-STUCK_AFTER)
  return tail.length === STUCK_AFTER && tail.every((report) => report[key] === tail[0]![key])
}

const has = (value: number | null): value is number => value !== null

/** A check on a value. It is made only when the value was sent. */
const judge = (value: number | null, test: (value: number) => boolean): boolean | null => (has(value) ? test(value) : null)
const between = (low: number, high: number) => (value: number) => value >= low && value <= high

/** A warning the buoy raises about its own values. Raised, it counts. Not raised, it says
 *  something only when at least one of those values was sent. */
const notFlagged = (flag: boolean, ...values: (number | null)[]): boolean | null => (flag ? false : values.some(has) ? true : null)

/** The signal-to-noise ratio below which an SX1262 cannot read a report: −7.5 dB at spreading
 *  factor 7 and 2.5 dB lower for each step up (Semtech SX1261/2 data sheet, table 6-1). */
export function snrLimitDb(spreadingFactor: number): number {
  return -2.5 * (spreadingFactor - 4)
}

/** What the judging needs to know about the radio link. A session carries both. */
export type Link = Pick<Session, 'interval_s' | 'spreading_factor'>

/** Judge every part from what the buoy has sent. These are the checks the shore can make by
 *  itself, on every report, with no question asked of the buoy. They say that a part reports
 *  and that its reading is believable; they cannot say that the reading is accurate.
 *  `cut` is true when the page cannot reach its database: then even the radio cannot be judged. */
export function assess(reports: readonly Report[], sinceHeardS: number, link: Link, cut = false): PartHealth[] {
  const latest = reports[reports.length - 1]
  if (!latest) return []
  const intervalS = link.interval_s
  const silent = sinceHeardS > 3 * intervalS
  const snrLimit = snrLimitDb(link.spreading_factor)
  const lost = reports.length > 1 ? latest.seq - reports[0]!.seq + 1 - reports.length : 0

  const judged: Record<PartId, { readings: [string, string][]; checks: Check[]; summary: string }> = {
    radio: {
      summary: `${fixed(latest.rssi_dbm, 0)} dBm, SNR ${fixed(latest.snr_db, 1)} dB`,
      readings: [
        ['Signal', `${fixed(latest.rssi_dbm, 0)} dBm`],
        ['Signal to noise', `${fixed(latest.snr_db, 1)} dB`],
        ['Above the radio\u2019s limit', `${fixed(has(latest.snr_db) ? latest.snr_db - snrLimit : null, 1)} dB`],
        ['Not heard', `${lost} of the last ${reports.length + lost}`],
      ],
      checks: [
        { label: `Heard within ${3 * intervalS} s`, passed: silent && cut ? null : !silent, severity: 'fail' },
        {
          label: `Signal above the radio\u2019s limit of ${fixed(snrLimit, 1)} dB at SF${link.spreading_factor}`,
          passed: judge(latest.snr_db, (snr) => snr > snrLimit),
          severity: 'doubt',
        },
        { label: 'Fewer than 1 report in 10 lost', passed: lost * 10 < reports.length + lost, severity: 'doubt' },
      ],
    },
    gnss: {
      summary: latest.position_valid ? `${latitude(latest.lat)} ${longitude(latest.lon)}` : 'no fix',
      readings: [['Latitude', latitude(latest.lat)], ['Longitude', longitude(latest.lon)], ['Clock', latest.time_valid ? 'set from the satellites' : 'not set']],
      checks: [
        { label: 'Has a position fix', passed: latest.position_valid && has(latest.lat) && has(latest.lon), severity: 'doubt' },
        { label: 'Clock set', passed: latest.time_valid, severity: 'doubt' },
      ],
    },
    air: {
      summary: `${fixed(latest.air_pressure_hpa, 1)} hPa, ${fixed(latest.air_temp_c, 1)} °C`,
      readings: [['Pressure', `${fixed(latest.air_pressure_hpa, 1)} hPa`], ['Temperature', `${fixed(latest.air_temp_c, 1)} °C`], ['Humidity', `${fixed(latest.humidity_pct, 0)} %`]],
      checks: [
        { label: 'Sends all three values', passed: has(latest.air_pressure_hpa) && has(latest.air_temp_c) && has(latest.humidity_pct), severity: 'fail' },
        { label: 'Pressure between 850 and 1085 hPa', passed: judge(latest.air_pressure_hpa, between(850, 1085)), severity: 'doubt' },
        { label: 'Temperature between \u221260 and 60 °C', passed: judge(latest.air_temp_c, between(-60, 60)), severity: 'doubt' },
      ],
    },
    computer: {
      summary: `report ${thousands(latest.seq)}, ${latest.backlog} waiting`,
      readings: [['Last report', thousands(latest.seq)], ['Waiting on board', String(latest.backlog)], ['State', latest.state]],
      checks: [
        { label: 'Report carries a valid tag', passed: latest.tag_ok, severity: 'fail' },
        { label: 'Fewer than 100 reports waiting on board', passed: latest.backlog < 100, severity: 'doubt' },
      ],
    },
    motion: {
      summary: `waves ${fixed(latest.wave_hs_m, 2)} m, tilt ${fixed(latest.tilt_deg, 1)}°`,
      readings: [['Wave height', `${fixed(latest.wave_hs_m, 2)} m`], ['Peak period', `${fixed(latest.wave_tp_s, 1)} s`], ['Mean tilt', `${fixed(latest.tilt_deg, 1)}°`]],
      checks: [
        { label: 'Sends wave height and tilt', passed: has(latest.wave_hs_m) && has(latest.tilt_deg), severity: 'fail' },
        { label: 'Tilt under 45°: the buoy is upright', passed: judge(latest.tilt_deg, (tilt) => tilt < 45), severity: 'fail' },
        { label: 'No sign of ice built up on the hull', passed: notFlagged(latest.icing_suspected, latest.tilt_deg), severity: 'doubt' },
      ],
    },
    power: {
      summary: `${fixed(latest.energy_j, 2)} J a report`,
      readings: [['Energy since the last report', `${fixed(latest.energy_j, 2)} J`], ['Inside the hull', `${fixed(latest.hull_temp_c, 0)} °C`]],
      checks: [{ label: 'Sends the energy used', passed: has(latest.energy_j), severity: 'fail' }],
    },
    battery: {
      summary: `${fixed(latest.battery_v, 2)} V`,
      readings: [['Voltage', `${fixed(latest.battery_v, 2)} V`], ['Charging', 'on shore only']],
      checks: [
        { label: 'Sends its voltage', passed: has(latest.battery_v), severity: 'fail' },
        { label: 'Above 3.0 V: not empty', passed: judge(latest.battery_v, (volts) => volts >= 3.0), severity: 'fail' },
        { label: 'Above 3.3 V and not flagged low', passed: latest.low_battery ? false : judge(latest.battery_v, (volts) => volts >= 3.3), severity: 'doubt' },
      ],
    },
    leak: {
      summary: latest.leak ? 'WET' : 'dry',
      readings: [['Probe', latest.leak ? 'wet' : 'dry']],
      checks: [{ label: 'Dry inside the hull', passed: !latest.leak, severity: 'fail' }],
    },
    noise: {
      summary: `${fixed(latest.noise_low_db, 1)} / ${fixed(latest.noise_mid_db, 1)} / ${fixed(latest.noise_high_db, 1)} dB`,
      readings: [['63\u2013250 Hz', `${fixed(latest.noise_low_db, 1)} dB`], ['0.25\u20131 kHz', `${fixed(latest.noise_mid_db, 1)} dB`], ['1\u20134 kHz', `${fixed(latest.noise_high_db, 1)} dB`]],
      checks: [
        { label: 'Sends all three bands', passed: has(latest.noise_low_db) && has(latest.noise_mid_db) && has(latest.noise_high_db), severity: 'fail' },
        { label: 'Not flagged doubtful by the buoy', passed: notFlagged(latest.noise_doubtful, latest.noise_low_db, latest.noise_mid_db, latest.noise_high_db), severity: 'doubt' },
      ],
    },
    water_temp: {
      summary: `${fixed(latest.water_temp_c, 2)} °C`,
      readings: [['Temperature', `${fixed(latest.water_temp_c, 2)} °C`], ['Freezing point here', `${fixed(latest.freezing_point_c, 2)} °C`]],
      checks: [
        { label: 'Sends a value', passed: has(latest.water_temp_c), severity: 'fail' },
        { label: 'Between \u22125 and 40 °C', passed: judge(latest.water_temp_c, between(-5, 40)), severity: 'doubt' },
        { label: `Not frozen at one value for ${STUCK_AFTER} reports`, passed: judge(latest.water_temp_c, () => !unchanged(reports, 'water_temp_c')), severity: 'doubt' },
      ],
    },
    conductivity: {
      summary: `${fixed(latest.conductivity_ms_cm, 2)} mS/cm`,
      readings: [['Conductivity', `${fixed(latest.conductivity_ms_cm, 2)} mS/cm`], ['Salinity from it', `${fixed(latest.salinity, 2)}, indicative`]],
      checks: [
        { label: 'Sends a value', passed: has(latest.conductivity_ms_cm), severity: 'fail' },
        { label: 'Above 0.05 mS/cm: the cell is in water', passed: judge(latest.conductivity_ms_cm, (value) => value > 0.05), severity: 'doubt' },
        { label: 'Not flagged doubtful by the buoy', passed: notFlagged(latest.conductivity_doubtful, latest.conductivity_ms_cm), severity: 'doubt' },
      ],
    },
    oxygen: { summary: 'not fitted', readings: [], checks: [] },
  }

  return PARTS.map((part) => {
    const { readings, checks, summary } = judged[part.id]
    const failed = checks.filter((check) => check.passed === false)
    const status: Status =
      part.id === 'oxygen'
        ? 'absent'
        : silent && (part.id !== 'radio' || cut)
          ? 'silent'
          : failed.some((check) => check.severity === 'fail')
            ? 'fail'
            : failed.length > 0
              ? 'doubt'
              : 'ok'
    return { part, status, summary, readings, checks }
  })
}

export const STATUS_WORD: Record<Status, string> = {
  ok: 'Working',
  doubt: 'Doubtful',
  fail: 'Failed',
  absent: 'Not fitted',
  silent: 'Not heard',
}
