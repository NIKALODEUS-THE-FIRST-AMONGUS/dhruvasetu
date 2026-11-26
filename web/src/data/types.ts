/** One report as the server sends it: the 42 decoded bytes of contract/report.v1.json
 *  plus what the receiver and the server add. A missing measurement is null. */
export type BuoyState = 'NORMAL' | 'ICE' | 'SURVIVAL'
export type Source = 'live' | 'simulated' | 'replay'

export interface Report {
  version: number
  type: 'report'
  buoy: number
  buoy_name: string
  seq: number
  time: number | null
  lat: number | null
  lon: number | null
  water_temp_c: number | null
  conductivity_ms_cm: number | null
  wave_hs_m: number | null
  wave_tp_s: number | null
  noise_low_db: number | null
  noise_mid_db: number | null
  noise_high_db: number | null
  air_pressure_hpa: number | null
  air_temp_c: number | null
  humidity_pct: number | null
  hull_temp_c: number | null
  battery_v: number | null
  energy_j: number | null
  tilt_deg: number | null
  ice_timer_pct: number | null
  state: BuoyState
  leak: boolean
  position_valid: boolean
  time_valid: boolean
  bench_timing: boolean
  conductivity_doubtful: boolean
  noise_doubtful: boolean
  low_battery: boolean
  icing_suspected: boolean
  recovered: boolean
  module_present: boolean
  backlog: number
  tag_ok: boolean | null
  /** Added by the server: practical salinity (PSS-78) and the freezing point that follows from it. */
  salinity: number | null
  freezing_point_c: number | null
  /** Added by the receiver. */
  rssi_dbm: number | null
  snr_db: number | null
  /** The 50 bytes as hexadecimal text. */
  raw: string
}

/** Names of the numeric measurements, for charts. */
export type Quantity = {
  [Key in keyof Report]: Report[Key] extends number | null ? Key : never
}[keyof Report]

export interface Session {
  /** What the numbers are: measured by a buoy, made up, or a recording played again. */
  source: Source
  /** How they reach the page: from a file built into it, or from the project's database as they arrive. */
  feed?: 'file' | 'hosted'
  scenario: string
  note: string
  interval_s: number
  frame_bytes: number
  airtime_ms: number
  spreading_factor: number
  received_total: number
  lost_total: number
  now: number
  reports: Report[]
}

const STATES: readonly string[] = ['NORMAL', 'ICE', 'SURVIVAL']
const SOURCES: readonly string[] = ['live', 'simulated', 'replay']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Check a report at the boundary. Throws with the reason instead of letting a bad one reach the page. */
export function parseReport(input: unknown): Report {
  if (!isRecord(input)) throw new Error('a report must be an object')
  if (input.version !== 1) throw new Error(`report format version ${String(input.version)} is not supported`)
  if (typeof input.seq !== 'number' || typeof input.raw !== 'string') throw new Error('a report needs seq and raw')
  if (typeof input.state !== 'string' || !STATES.includes(input.state)) throw new Error(`unknown state ${String(input.state)}`)
  return input as unknown as Report
}

export function parseSession(input: unknown): Session {
  if (!isRecord(input) || !Array.isArray(input.reports)) throw new Error('a session needs a list of reports')
  if (typeof input.source !== 'string' || !SOURCES.includes(input.source)) throw new Error('a session needs a source')
  return { ...(input as unknown as Session), reports: input.reports.map(parseReport) }
}
