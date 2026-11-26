import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { AnimatedNumber, Sparkline } from '../components/basics'
import { BuoyScene } from '../components/BuoyScene'
import { Chartlet } from '../components/Chartlet'
import type { Telemetry } from '../data/store'
import type { BuoyState, Report } from '../data/types'
import { drift, fixed, gaps, latitude, longitude, series, signed, thousands, trendPerHour, utcDate, utcTime } from '../lib/format'

const HISTORY = 60
const rise = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 0.8, 0.26, 1] as const } },
}

interface TileProps {
  label: string
  value: number | null
  digits: number
  unit: string
  history: readonly number[]
  /** The small curve never zooms in further than this many units. */
  minSpan: number
  window: string
  children?: ReactNode
}

function Tile({ label, value, digits, unit, history, minSpan, window, children }: TileProps) {
  const format = (current: number | null) => fixed(current, digits)
  return (
    <motion.section className="tile" variants={rise} aria-label={label}>
      <h2 className="label">{label}</h2>
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
      <h2 className="label">Underwater noise</h2>
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
        <span className="tag">relative</span>
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

interface LogEntry {
  time: number | null
  text: string
  warn?: boolean
}

function logEntries(reports: readonly Report[], latest: Report): LogEntry[] {
  const entries: LogEntry[] = [{ time: latest.time, text: `Report ${thousands(latest.seq)} heard, SNR ${fixed(latest.snr_db, 1)} dB` }]
  const pressure = trendPerHour(reports, 'air_pressure_hpa')
  if (pressure !== null && pressure <= -1) {
    entries.push({ time: latest.time, text: `Air pressure falling ${fixed(-pressure, 1)} hPa an hour`, warn: true })
  }
  for (const [first, last] of gaps(reports).slice(-2).reverse()) {
    const after = reports.find((report) => report.seq === last + 1)
    entries.push({
      time: after?.time ?? null,
      text: first === last ? `Report ${thousands(first)} not heard` : `Reports ${thousands(first)} to ${thousands(last)} not heard`,
      warn: true,
    })
  }
  entries.push({ time: reports[0]?.time ?? null, text: `State ${latest.state}; leak sensor ${latest.leak ? 'WET' : 'dry'}` })
  return entries.slice(0, 4)
}

export function LiveView({ telemetry }: { telemetry: Telemetry }) {
  const { reports, latest, session } = telemetry
  const window = `${Math.round((Math.min(reports.length, HISTORY) * session.interval_s) / 60)} min`
  const history = (key: Parameters<typeof series>[1]) => series(reports, key, HISTORY)
  const aboveFreezing =
    latest.water_temp_c !== null && latest.freezing_point_c !== null ? latest.water_temp_c - latest.freezing_point_c : null
  const pressureTrend = trendPerHour(reports.slice(-HISTORY), 'air_pressure_hpa')
  const moved = drift(reports)
  const firstFix = reports.find((report) => report.lat !== null && report.lon !== null)
  const smallWaves = latest.wave_hs_m !== null && latest.wave_hs_m < 0.995
  const waveFactor = smallWaves ? 100 : 1
  const sent = session.received_total + session.lost_total

  return (
    <div className="live">
      <section className="state" data-state={latest.state} aria-label="State of the buoy">
        <div className="state__now" role="status">
          <StateGlyph state={latest.state} />
          <span className="state__word">{latest.state}</span>
        </div>
        <div className="fact">
          <span className="label">Water above its freezing point</span>
          <span className="fact__value">{fixed(aboveFreezing, 2)} °C</span>
        </div>
        <div className="fact">
          <span className="label">Wave height</span>
          <span className="fact__value">{fixed(latest.wave_hs_m, 2)} m</span>
        </div>
        <div className="fact">
          <span className="label">Freeze-in window</span>
          <span className="fact__value">
            {fixed(latest.ice_timer_pct, 0)} % {latest.bench_timing && <span className="tag">bench timing</span>}
          </span>
        </div>
        <div className="fact">
          <span className="label">Leak sensor</span>
          <span className="fact__value" style={latest.leak ? { color: 'var(--alarm)' } : undefined}>
            {latest.leak ? 'WET' : 'dry'}
          </span>
        </div>
        <div className="state__clock mono">
          <div>
            {utcDate(latest.time)} · {utcTime(latest.time)} UTC
          </div>
          <div>report {thousands(latest.seq)}</div>
        </div>
      </section>

      <div className="board">
        <motion.div className="tiles" initial="hidden" animate="shown" transition={{ staggerChildren: 0.05 }}>
          <Tile label="Sea-surface temperature" value={latest.water_temp_c} digits={1} unit="°C" history={history('water_temp_c')} minSpan={0.2} window={window}>
            <span>{fixed(aboveFreezing, 2)} °C above freezing</span>
          </Tile>
          <Tile label="Conductivity" value={latest.conductivity_ms_cm} digits={1} unit="mS/cm" history={history('conductivity_ms_cm')} minSpan={0.3} window={window}>
            <span>salinity {fixed(latest.salinity, 1)}</span>
            <span className="tag">indicative</span>
          </Tile>
          <Tile
            label="Significant wave height"
            value={latest.wave_hs_m === null ? null : latest.wave_hs_m * waveFactor}
            digits={1}
            unit={smallWaves ? 'cm' : 'm'}
            history={history('wave_hs_m').map((value) => value * waveFactor)}
            minSpan={smallWaves ? 5 : 0.6}
            window={window}
          >
            <span>peak period {fixed(latest.wave_tp_s, 1)} s</span>
          </Tile>
          <NoiseTile report={latest} />
          <Tile label="Air pressure" value={latest.air_pressure_hpa} digits={1} unit="hPa" history={history('air_pressure_hpa')} minSpan={1.5} window={window}>
            {pressureTrend !== null && (
              <span>
                {Math.abs(pressureTrend) < 0.3
                  ? 'steady'
                  : `${pressureTrend < 0 ? '\u2193 falling' : '\u2191 rising'} ${fixed(Math.abs(pressureTrend), 1)} hPa an hour`}
              </span>
            )}
          </Tile>
          <Tile label="Air temperature" value={latest.air_temp_c} digits={1} unit="°C" history={history('air_temp_c')} minSpan={1} window={window}>
            <span>inside the hull {fixed(latest.hull_temp_c, 0)} °C</span>
          </Tile>
          <Tile label="Relative humidity" value={latest.humidity_pct} digits={0} unit="%" history={history('humidity_pct')} minSpan={6} window={window} />
          <motion.section className="tile tile--absent" variants={rise} aria-label="Dissolved oxygen">
            <h2 className="label">Dissolved oxygen</h2>
            <p className="tile__value">Not fitted</p>
            <div className="tile__sub">
              <span>A costed option. One port of the sensor plate is kept blanked for the probe.</span>
            </div>
          </motion.section>
        </motion.div>

        <aside className="side">
          <div className="panel">
            <div className="panel__head">
              <h2 className="label">Buoy DS-{String(latest.buoy).padStart(2, '0')}</h2>
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
            <h2 className="label">Log</h2>
            <ol className="events__list">
              <AnimatePresence initial={false}>
                {logEntries(reports, latest).map((entry) => (
                  <motion.li
                    key={entry.text.replace(/\d[\d,.]*/g, '#')}
                    className={entry.warn ? 'event event--warn' : 'event'}
                    layout
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <span className="event__time mono">{utcTime(entry.time)}</span>
                    <span className="event__text">{entry.text}</span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ol>
          </div>
        </aside>
      </div>

      <footer className="strip">
        <div className="strip__cell">
          <span className="label">Battery</span>
          <strong>{fixed(latest.battery_v, 2)} V</strong>
          <span>{fixed(latest.energy_j, 2)} J a report</span>
        </div>
        <div className="strip__cell">
          <span className="label">Link</span>
          <strong>{fixed(latest.rssi_dbm, 0)} dBm</strong>
          <span>SNR {fixed(latest.snr_db, 1)} dB</span>
          <span>
            {thousands(session.lost_total)} of {thousands(sent)} not heard ({fixed((100 * session.lost_total) / sent, 1)} %)
          </span>
        </div>
        <div className="strip__cell">
          <span className="label">Last report</span>
          <strong>{session.frame_bytes} bytes</strong>
          <span>
            {session.airtime_ms} ms on air at SF{session.spreading_factor}
          </span>
          <span>short enough for one satellite message</span>
          <span className="hex mono" title="The report as sent. The last 8 bytes are its authentication tag.">
            <span className="hex__payload">{latest.raw.slice(0, -16)}</span>
            <b>{latest.raw.slice(-16)}</b>
          </span>
        </div>
      </footer>
    </div>
  )
}
