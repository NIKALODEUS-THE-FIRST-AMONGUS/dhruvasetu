import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { AnimatedNumber, Sparkline, Step } from '../components/basics'
import { BuoyScene } from '../components/BuoyScene'
import { Chartlet } from '../components/Chartlet'
import type { Telemetry } from '../data/store'
import type { BuoyState, Quantity, Report } from '../data/types'
import { drift, fixed, gaps, latitude, longitude, series, signed, thousands, utcDate, utcTime } from '../lib/format'
import { headline, notices, trendText } from '../lib/insight'

const HISTORY = 60
const rise = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 0.8, 0.26, 1] as const } },
}

interface TileProps {
  label: string
  /** A standing caveat on the measurement, shown beside its name. */
  qualifier?: string
  value: number | null
  digits: number
  unit: string
  history: readonly number[]
  /** The small curve never zooms in further than this many units. */
  minSpan: number
  window: string
  /** True when the headline is talking about this measurement. */
  marked?: boolean
  /** Guide marker shown before the name. */
  step?: ReactNode
  children?: ReactNode
}

function Tile({ label, qualifier, value, digits, unit, history, minSpan, window, marked, step, children }: TileProps) {
  const format = (current: number | null) => fixed(current, digits)
  return (
    <motion.section className={marked ? 'tile tile--marked' : 'tile'} variants={rise} aria-label={label}>
      <h2 className="label">
        {step}
        {label}
        {qualifier && <span className="label__note"> · {qualifier}</span>}
      </h2>
      <p className="tile__value">
        <AnimatedNumber value={value} format={format} />
        <span className="tile__unit">{unit}</span>
      </p>
      <div className="tile__sub">{children}</div>
      <div className="tile__chart">
        <Sparkline values={history} minSpan={minSpan} label={`${label} over the last ${window}`} />
        <div className="tile__range mono">
          <span>{history.length > 1 ? `${fixed(Math.min(...history), digits + 1)} to ${fixed(Math.max(...history), digits + 1)}` : ''}</span>
          <span>{window}</span>
        </div>
      </div>
    </motion.section>
  )
}

const NOISE_LOW = -10
const NOISE_HIGH = 15

function NoiseTile({ report }: { report: Report }) {
  const bands: [string, number | null][] = [
    ['63\u2013250 Hz', report.noise_low_db],
    ['0.25\u20131 kHz', report.noise_mid_db],
    ['1\u20134 kHz', report.noise_high_db],
  ]
  const place = (level: number) => ((Math.min(NOISE_HIGH, Math.max(NOISE_LOW, level)) - NOISE_LOW) / (NOISE_HIGH - NOISE_LOW)) * 100
  const zero = place(0)
  return (
    <motion.section className="tile" variants={rise} aria-label="Underwater noise">
      <h2 className="label">
        Underwater noise<span className="label__note"> · relative</span>
      </h2>
      <div className="bars">
        {bands.map(([band, level]) => (
          <div className="bar" key={band}>
            <span>{band}</span>
            <span className="bar__value mono">{signed(level, 1)} dB</span>
            <div className="bar__track">
              {level !== null && (
                <motion.div
                  className="bar__fill"
                  initial={false}
                  animate={{ left: `${Math.min(zero, place(level))}%`, width: `${Math.abs(place(level) - zero)}%` }}
                  transition={{ type: 'spring', stiffness: 160, damping: 26 }}
                />
              )}
              <div className="bar__zero" style={{ left: `${zero}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="tile__sub" style={{ marginTop: 'auto' }}>
        <span>against the quiet baseline</span>
      </div>
    </motion.section>
  )
}

function StateGlyph({ state }: { state: BuoyState }) {
  return (
    <svg className="state__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      {state === 'NORMAL' && <circle cx="12" cy="12" r="8" fill="currentColor" stroke="none" />}
      {state === 'ICE' && <path d="M12 2 V22 M3.3 7 L20.7 17 M20.7 7 L3.3 17" />}
      {state === 'SURVIVAL' && <path d="M12 3 L22 21 H2 Z" fill="currentColor" stroke="none" />}
    </svg>
  )
}

interface BuoyEvent {
  time: number | null
  text: string
}

/** Things that happened, newest first: reports not heard, a change of state, an alarm.
 *  Current values are not events; they are on the page already. */
function events(reports: readonly Report[]): BuoyEvent[] {
  const found: BuoyEvent[] = []
  for (const [first, last] of gaps(reports)) {
    const next = reports.find((report) => report.seq === last + 1)
    found.push({
      time: next?.time ?? null,
      text: first === last ? `Report ${thousands(first)} not heard` : `Reports ${thousands(first)} to ${thousands(last)} not heard`,
    })
  }
  for (let index = 1; index < reports.length; index += 1) {
    const before = reports[index - 1]!
    const now = reports[index]!
    if (now.state !== before.state) found.push({ time: now.time, text: `State changed from ${before.state} to ${now.state}` })
    if (now.leak && !before.leak) found.push({ time: now.time, text: 'Leak sensor wet' })
    if (now.low_battery && !before.low_battery) found.push({ time: now.time, text: 'Battery low' })
  }
  return found.sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, 4)
}

interface LiveViewProps {
  telemetry: Telemetry
  /** Seconds since the last report reached the page. */
  sinceHeard: number
  /** True while the reading guide is open: the numbered markers show. */
  guide: boolean
}

export function LiveView({ telemetry, sinceHeard, guide }: LiveViewProps) {
  const { reports, latest, session } = telemetry
  const window = `${Math.round((Math.min(reports.length, HISTORY) * session.interval_s) / 60)} min`
  const history = (key: Quantity) => series(reports, key, HISTORY)
  const aboveFreezing =
    latest.water_temp_c !== null && latest.freezing_point_c !== null ? latest.water_temp_c - latest.freezing_point_c : null
  const recent = reports.slice(-HISTORY)
  const noticed = notices(recent, sinceHeard, session.interval_s)
  const marked = (place: string) => noticed.some((notice) => notice.place === place)
  const alarmed = noticed.some((notice) => notice.tone === 'alarm')
  const moved = drift(reports)
  const firstFix = reports.find((report) => report.lat !== null && report.lon !== null)
  const smallWaves = latest.wave_hs_m !== null && latest.wave_hs_m < 0.995
  const waveFactor = smallWaves ? 100 : 1
  const sent = session.received_total + session.lost_total
  const happened = events(reports)

  return (
    <div className="live">
      <section className="state" data-state={latest.state} data-alarm={alarmed || undefined} aria-label="State of the buoy">
        <div className="state__now">
          <Step number={2} shown={guide} />
          <StateGlyph state={latest.state} />
          <span className="state__word">{latest.state}</span>
        </div>
        <p className="state__headline" role="status">
          {headline(latest, noticed)}
        </p>
        <div className="state__clock mono">
          {utcDate(latest.time)} · {utcTime(latest.time)} UTC
        </div>
      </section>

      <div className="board">
        <motion.div className="tiles" initial="hidden" animate="shown" transition={{ staggerChildren: 0.05 }}>
          <Tile
            label="Sea-surface temperature"
            value={latest.water_temp_c}
            digits={1}
            unit="°C"
            history={history('water_temp_c')}
            minSpan={0.2}
            window={window}
            marked={marked('water_temp_c')}
            step={<Step number={3} shown={guide} />}
          >
            <span>{trendText(recent, 'water_temp_c', 1, '°C')}</span>
            <span>{fixed(aboveFreezing, 2)} °C above freezing</span>
          </Tile>
          <Tile
            label="Conductivity"
            qualifier="indicative"
            value={latest.conductivity_ms_cm}
            digits={1}
            unit="mS/cm"
            history={history('conductivity_ms_cm')}
            minSpan={0.3}
            window={window}
            marked={marked('conductivity_ms_cm')}
          >
            <span>{trendText(recent, 'conductivity_ms_cm', 1, 'mS/cm')}</span>
            <span>salinity {fixed(latest.salinity, 1)}</span>
          </Tile>
          <Tile
            label="Significant wave height"
            value={latest.wave_hs_m === null ? null : latest.wave_hs_m * waveFactor}
            digits={1}
            unit={smallWaves ? 'cm' : 'm'}
            history={history('wave_hs_m').map((value) => value * waveFactor)}
            minSpan={smallWaves ? 5 : 0.6}
            window={window}
            marked={marked('wave_hs_m')}
          >
            <span>{trendText(recent, 'wave_hs_m', 1, smallWaves ? 'cm' : 'm', waveFactor)}</span>
            <span>period {fixed(latest.wave_tp_s, 1)} s</span>
          </Tile>
          <NoiseTile report={latest} />
          <Tile label="Air pressure" value={latest.air_pressure_hpa} digits={1} unit="hPa" history={history('air_pressure_hpa')} minSpan={1.5} window={window} marked={marked('air_pressure_hpa')}>
            <span>{trendText(recent, 'air_pressure_hpa', 1, 'hPa')}</span>
          </Tile>
          <Tile label="Air temperature" value={latest.air_temp_c} digits={1} unit="°C" history={history('air_temp_c')} minSpan={1} window={window} marked={marked('air_temp_c')}>
            <span>{trendText(recent, 'air_temp_c', 1, '°C')}</span>
          </Tile>
          <Tile label="Relative humidity" value={latest.humidity_pct} digits={0} unit="%" history={history('humidity_pct')} minSpan={6} window={window}>
            <span>{trendText(recent, 'humidity_pct', 0, '%')}</span>
          </Tile>
          <motion.section className="tile tile--absent" variants={rise} aria-label="Dissolved oxygen">
            <h2 className="label">Dissolved oxygen</h2>
            <p className="tile__value">Not fitted</p>
            <div className="tile__sub">
              <span>A costed option. Its port is blanked.</span>
            </div>
          </motion.section>
        </motion.div>

        <aside className="side">
          <div className="panel">
            <div className="panel__head">
              <h2 className="label">
                <Step number={4} shown={guide} />
                Buoy DS-{String(latest.buoy).padStart(2, '0')}
              </h2>
              <span className="panel__note mono">tilt {fixed(latest.tilt_deg, 1)}°</span>
            </div>
            <BuoyScene
              waveHeightM={latest.wave_hs_m}
              wavePeriodS={latest.wave_tp_s}
              tiltDeg={latest.tilt_deg}
              state={latest.state}
              pulse={latest.seq}
            />
            <p className="panel__foot">The swell passes at the measured period. Hull to its own scale, not the sea's.</p>
          </div>
          <div className="panel">
            <div className="panel__head">
              <h2 className="label">Position</h2>
              <span className="panel__note mono">
                {latest.position_valid ? `${latitude(latest.lat)}  ${longitude(latest.lon)}` : 'no fix'}
                {moved?.speedMs != null && moved.bearingDeg !== null && (
                  <>
                    <br />
                    {fixed(moved.speedMs, 2)} m/s toward {String(Math.round(moved.bearingDeg)).padStart(3, '0')}°
                  </>
                )}
              </span>
            </div>
            <Chartlet drift={moved} originLat={firstFix?.lat ?? null} originLon={firstFix?.lon ?? null} waterName={session.scenario.split(',')[0] ?? ''} />
          </div>
          <div className="panel events">
            <h2 className="label">Events</h2>
            {happened.length === 0 && <p className="events__none">None in this session.</p>}
            <ol className="events__list">
              <AnimatePresence initial={false}>
                {happened.map((event) => (
                  <motion.li
                    key={event.text}
                    className="event"
                    layout
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <span className="event__time mono">{utcTime(event.time)}</span>
                    <span className="event__text">{event.text}</span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ol>
          </div>
        </aside>
      </div>

      <footer className="strip">
        <div className={marked('hull') ? 'strip__cell strip__cell--marked' : 'strip__cell'}>
          <span className="label">
            <Step number={5} shown={guide} />
            Hull
          </span>
          <strong>{fixed(latest.battery_v, 2)} V</strong>
          <span>{fixed(latest.energy_j, 2)} J a report</span>
          <span>{fixed(latest.hull_temp_c, 0)} °C inside</span>
          <span style={latest.leak ? { color: 'var(--alarm)' } : undefined}>{latest.leak ? 'leak sensor WET' : 'dry'}</span>
        </div>
        <div className={marked('link') ? 'strip__cell strip__cell--marked' : 'strip__cell'}>
          <span className="label">Link</span>
          <strong>{fixed(latest.rssi_dbm, 0)} dBm</strong>
          <span>SNR {fixed(latest.snr_db, 1)} dB</span>
          <span>
            {thousands(session.lost_total)} of {thousands(sent)} reports not heard
          </span>
        </div>
        <div className="strip__cell">
          <span className="label">Report</span>
          <strong>{thousands(latest.seq)}</strong>
          <span>{session.frame_bytes} bytes</span>
          {latest.tag_ok === false ? <span style={{ color: 'var(--alarm)' }}>tag does not match</span> : latest.tag_ok && <span>tag checked</span>}
        </div>
      </footer>
    </div>
  )
}
