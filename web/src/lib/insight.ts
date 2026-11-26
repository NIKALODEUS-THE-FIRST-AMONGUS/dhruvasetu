import type { Quantity, Report } from '../data/types'
import { fixed, gaps, trendPerHour } from './format'

/** Where on the page a notice points: a measurement tile, or a cell of the bottom line. */
export type Place = Quantity | 'link' | 'hull'

export interface Notice {
  tone: 'notice' | 'alarm'
  text: string
  place: Place
}

/** Sea state by significant wave height, WMO code table 3700 (the Douglas scale). */
const SEA_STATES: readonly (readonly [number, string])[] = [
  [0.1, 'calm'], [0.5, 'smooth'], [1.25, 'slight'], [2.5, 'moderate'],
  [4, 'rough'], [6, 'very rough'], [9, 'high'], [14, 'very high'],
]

export function seaState(heightM: number | null): string | null {
  if (heightM === null) return null
  return SEA_STATES.find(([limit]) => heightM < limit)?.[1] ?? 'phenomenal'
}

/** Below this change per hour a quantity is called steady. */
export const STEADY_BELOW: Partial<Record<Quantity, number>> = {
  water_temp_c: 0.5,
  conductivity_ms_cm: 0.5,
  wave_hs_m: 0.5,
  air_pressure_hpa: 0.3,
  air_temp_c: 1,
  humidity_pct: 5,
}

/** What a quantity is doing, in words: "steady", or "falling 1.8 hPa an hour". */
export function trendText(reports: readonly Report[], key: Quantity, digits: number, unit: string, factor = 1): string {
  const perHour = trendPerHour(reports, key)
  if (perHour === null) return ''
  if (Math.abs(perHour) < (STEADY_BELOW[key] ?? 0)) return 'steady'
  return `${perHour < 0 ? '\u2193 falling' : '\u2191 rising'} ${fixed(Math.abs(perHour) * factor, digits)} ${unit} an hour`
}

/** Everything that deserves attention right now, most serious first.
 *  The headline says these in words and the page marks the place each one points to. */
export function notices(reports: readonly Report[], sinceHeardS: number, intervalS: number): Notice[] {
  const latest = reports[reports.length - 1]
  if (!latest) return []
  const found: Notice[] = []
  if (sinceHeardS > 3 * intervalS) {
    found.push({ tone: 'alarm', text: `Nothing heard for ${Math.round(sinceHeardS)} s.`, place: 'link' })
  }
  if (latest.leak) found.push({ tone: 'alarm', text: 'Water inside the hull.', place: 'hull' })
  if (latest.tag_ok === false) {
    found.push({ tone: 'alarm', text: 'The last report failed its check and may not be the buoy\u2019s own.', place: 'link' })
  }
  if (latest.low_battery) found.push({ tone: 'notice', text: 'The battery is low.', place: 'hull' })
  if (latest.icing_suspected) found.push({ tone: 'notice', text: 'The hull leans as if ice has built up on it.', place: 'hull' })

  const aboveFreezing =
    latest.water_temp_c !== null && latest.freezing_point_c !== null ? latest.water_temp_c - latest.freezing_point_c : null
  if (latest.state === 'NORMAL' && (latest.ice_timer_pct ?? 0) > 0) {
    found.push({
      tone: 'notice',
      text: `Ice conditions have held for ${latest.ice_timer_pct} % of the window${latest.bench_timing ? ', on bench timing' : ''}.`,
      place: 'water_temp_c',
    })
  } else if (latest.state === 'NORMAL' && aboveFreezing !== null && aboveFreezing <= 0.5) {
    found.push({ tone: 'notice', text: 'The water is at its freezing point.', place: 'water_temp_c' })
  }

  const pressure = trendPerHour(reports, 'air_pressure_hpa')
  if (pressure !== null && pressure <= -1) {
    found.push({ tone: 'notice', text: `Air pressure is falling ${fixed(-pressure, 1)} hPa an hour.`, place: 'air_pressure_hpa' })
  }

  const lost = gaps(reports).reduce((count, [first, last]) => count + last - first + 1, 0)
  if (lost > 0) {
    found.push({ tone: 'notice', text: `${lost} ${lost === 1 ? 'report was' : 'reports were'} not heard.`, place: 'link' })
  }
  return found.sort((a, b) => Number(b.tone === 'alarm') - Number(a.tone === 'alarm'))
}

/** One or two sentences that say what the page shows: the state, then what deserves attention. */
export function headline(latest: Report, found: readonly Notice[]): string {
  const alarms = found.filter((notice) => notice.tone === 'alarm')
  if (alarms.length > 0) return `${alarms.map((notice) => notice.text).join(' ')} State ${latest.state}.`
  const sea = seaState(latest.wave_hs_m)
  const state =
    latest.state === 'ICE'
      ? 'Held in ice. It reports once a day; conductivity and noise are doubtful.'
      : latest.state === 'SURVIVAL'
        ? 'Survival mode: one short report a day.'
        : sea === null
          ? 'Working normally.'
          : sea === 'calm'
            ? 'Working normally in calm water.'
            : `Working normally in a ${sea} sea.`
  return [state, ...found.slice(0, 2).map((notice) => notice.text)].join(' ')
}
