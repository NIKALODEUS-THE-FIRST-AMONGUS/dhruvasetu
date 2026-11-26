import type { Quantity, Report } from '../data/types'

const MINUS = '\u2212'
const DASH = '\u2014'

/** A number with a fixed count of decimals, a true minus sign, and a dash when it is missing. */
export function fixed(value: number | null | undefined, digits: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH
  const text = Math.abs(value).toFixed(digits)
  return value < 0 && Number(text) !== 0 ? MINUS + text : text
}

/** As `fixed`, with a plus sign on positive values: for differences and relative levels. */
export function signed(value: number | null | undefined, digits: number): string {
  const text = fixed(value, digits)
  return value !== null && value !== undefined && value > 0 && Number(value.toFixed(digits)) !== 0 ? `+${text}` : text
}

export function thousands(value: number): string {
  return value.toLocaleString('en-GB')
}

function angle(value: number, degreeDigits: number, positive: string, negative: string): string {
  const absolute = Math.abs(value)
  let degrees = Math.floor(absolute)
  let minutes = (absolute - degrees) * 60
  if (Number(minutes.toFixed(2)) >= 60) {
    degrees += 1
    minutes = 0
  }
  return `${String(degrees).padStart(degreeDigits, '0')}\u00b0${minutes.toFixed(2).padStart(5, '0')}\u2032\u2009${value < 0 ? negative : positive}`
}

/** Degrees and decimal minutes, the way a chart and a ship's log write a position. */
export function latitude(value: number | null): string {
  return value === null ? DASH : angle(value, 2, 'N', 'S')
}

export function longitude(value: number | null): string {
  return value === null ? DASH : angle(value, 3, 'E', 'W')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function utcTime(seconds: number | null): string {
  if (seconds === null) return DASH
  return new Date(seconds * 1000).toISOString().slice(11, 19)
}

export function utcDate(seconds: number | null): string {
  if (seconds === null) return DASH
  const date = new Date(seconds * 1000)
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/** A length of time in the largest unit that reads well: "45 s", "10 min", "3 h". */
export function duration(seconds: number): string {
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))} s`
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`
  return `${Math.round(seconds / 3600)} h`
}

export function ago(seconds: number): string {
  return `${duration(seconds)} ago`
}

/** The last `count` values of one quantity, missing ones left out. */
export function series(reports: readonly Report[], key: Quantity, count: number): number[] {
  const values: number[] = []
  for (let index = Math.max(0, reports.length - count); index < reports.length; index += 1) {
    const value = reports[index]![key]
    if (value !== null) values.push(value)
  }
  return values
}

/** Change per hour by a least-squares line through the reports that carry a time. */
export function trendPerHour(reports: readonly Report[], key: Quantity): number | null {
  const points = reports.flatMap((report) => {
    const value = report[key]
    return report.time !== null && value !== null ? [[report.time, value] as const] : []
  })
  if (points.length < 3) return null
  const meanTime = points.reduce((sum, point) => sum + point[0], 0) / points.length
  const meanValue = points.reduce((sum, point) => sum + point[1], 0) / points.length
  let numerator = 0
  let denominator = 0
  for (const [time, value] of points) {
    numerator += (time - meanTime) * (value - meanValue)
    denominator += (time - meanTime) ** 2
  }
  return denominator === 0 ? null : (numerator / denominator) * 3600
}

export interface Drift {
  /** Positions as metres east and north of the first one. */
  path: [number, number][]
  distanceM: number
  speedMs: number | null
  bearingDeg: number | null
}

const METRES_PER_DEGREE = 111_320

export function drift(reports: readonly Report[]): Drift | null {
  const fixes = reports.filter((report) => report.lat !== null && report.lon !== null)
  const first = fixes[0]
  const last = fixes[fixes.length - 1]
  if (!first || !last) return null
  const eastScale = METRES_PER_DEGREE * Math.cos((first.lat! * Math.PI) / 180)
  const path = fixes.map((report): [number, number] => [
    (report.lon! - first.lon!) * eastScale,
    (report.lat! - first.lat!) * METRES_PER_DEGREE,
  ])
  const [east, north] = path[path.length - 1]!
  const distanceM = Math.hypot(east, north)
  const seconds = first.time !== null && last.time !== null ? last.time - first.time : 0
  return {
    path,
    distanceM,
    speedMs: seconds > 0 ? distanceM / seconds : null,
    bearingDeg: distanceM > 0 ? (Math.atan2(east, north) * 180 / Math.PI + 360) % 360 : null,
  }
}

/** Sequence numbers missing between the reports that were heard. */
export function gaps(reports: readonly Report[]): [number, number][] {
  const found: [number, number][] = []
  for (let index = 1; index < reports.length; index += 1) {
    const previous = reports[index - 1]!.seq
    const current = reports[index]!.seq
    if (current - previous > 1) found.push([previous + 1, current - 1])
  }
  return found
}
