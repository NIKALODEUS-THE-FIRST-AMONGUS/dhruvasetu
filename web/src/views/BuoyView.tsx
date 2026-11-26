import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { FAULTS, selfTest } from '../data/simulatedBuoy'
import type { Fault, SelfTest } from '../data/simulatedBuoy'
import type { Telemetry } from '../data/store'
import { thousands } from '../lib/format'
import { PARTS, STATUS_WORD, assess } from '../lib/health'
import type { PartHealth, PartId, Status } from '../lib/health'

/** The section is drawn in millimetres: x from the axis, z above the keel plate. */
const LEFT = -235
const WIDTH = 470
const TOP = 475
const HEIGHT = 570
const WATERLINE = 177
const across = (x: number) => ((x - LEFT) / WIDTH) * 100
const down = (z: number) => ((TOP - z) / HEIGHT) * 100

const mirror = (half: readonly (readonly [number, number])[]) =>
  [...half, ...[...half].reverse().map(([r, z]) => [-r, z] as const)].map(([r, z]) => `${r},${-z}`).join(' ')
const OUTSIDE = mirror([[104, 0], [110, 6], [110, 68], [132, 68], [132, 90], [114.7, 90], [160, 187.2], [160, 248.2], [146, 248.2], [60, 338.2]])
const BELOW_DECK = mirror([[106, 6], [105.6, 80], [153.2, 182.2], [128, 182.2], [128, 187.2]])
const UNDER_LID = mirror([[140, 192.2], [140, 248.2], [141.5, 248.2], [58.3, 334.2]])
const box = (x1: number, x2: number, z1: number, z2: number) => ({ x: x1, y: -z2, width: x2 - x1, height: z2 - z1 })

/** Section through the axis of hull H3, from the parameters of the Fusion model.
 *  Where each sensor sits follows the sensor proposal of the project file; none is built yet. */
function Section() {
  return (
    <svg className="section__drawing" viewBox={`${LEFT} ${-TOP} ${WIDTH} ${HEIGHT}`} role="img" aria-label="Section through the buoy showing where each part sits">
      <rect className="section__sea" {...box(LEFT, LEFT + WIDTH, TOP - HEIGHT, WATERLINE)} />
      <line className="section__surface" x1={LEFT} y1={-WATERLINE} x2={LEFT + WIDTH} y2={-WATERLINE} />
      <line className="section__line" x1={0} y1={-338.2} x2={0} y2={-450} />
      <circle className="section__metal" cx={0} cy={-450} r={3} />
      {[-85, 85].map((x) => (
        <rect key={x} className="section__metal" {...box(x - 4, x + 4, -65, 6)} />
      ))}
      <rect className="section__metal" {...box(-100, -65, -53, -35)} />
      <rect className="section__metal" {...box(65, 100, -53, -35)} />
      <polygon className="section__wall" points={OUTSIDE} />
      <polygon className="section__room" points={BELOW_DECK} />
      <polygon className="section__room" points={UNDER_LID} />
      <rect className="section__belt" {...box(-160, -140, 187.2, 242.2)} />
      <rect className="section__belt" {...box(140, 160, 187.2, 242.2)} />
      <rect className="section__part" {...box(52, 55, 90, 187.2)} />
      <rect className="section__part" {...box(63, 64.6, 98, 183)} />
      {[[158, 182], [136, 154], [104, 126]].map(([low, high]) => (
        <rect key={low} className="section__part" {...box(64.6, 84, low!, high!)} />
      ))}
      <rect className="section__part" {...box(-94, -58, 95, 157)} />
      <line className="section__line" x1={-76} y1={-95} x2={-76} y2={-157} />
      <rect className="section__part" {...box(-102, -84, 256, 268)} />
      <rect className="section__part" {...box(8, 34, 324, 331)} />
      <rect className="section__part" {...box(-14, 14, 6, 9)} />
      <rect className="section__part" {...box(-27.5, -22.5, -40, 12)} />
      <rect className="section__part" {...box(18, 32, -27, 0)} />
      <rect className="section__blank" {...box(43, 57, -6, 6)} />
      <circle className="section__metal" cx={-88} cy={-8.5} r={2} />
      <circle className="section__metal" cx={-80} cy={-8.5} r={2} />
      <text className="section__note" x={LEFT + 8} y={-WATERLINE - 6}>
        waterline
      </text>
    </svg>
  )
}

function StatusMark({ status }: { status: Status }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {status === 'ok' && <path d="M4 8.4 L7 11.2 L12 5.2" />}
      {status === 'doubt' && <path d="M8 3.8 V9 M8 12 V12.2" />}
      {status === 'fail' && <path d="M4.6 4.6 L11.4 11.4 M11.4 4.6 L4.6 11.4" />}
      {status === 'silent' && <path d="M4.5 8 H11.5" />}
    </svg>
  )
}

interface Answer extends SelfTest {
  /** The report the answer came with. */
  seq: number
}

interface BuoyViewProps {
  telemetry: Telemetry
  sinceHeard: number
  /** True when no further report will arrive by itself: answers then come after a short pause. */
  held: boolean
  fault: Fault
  onFault: (fault: Fault) => void
  /** A part whose window is open when the view appears. */
  initialPart: PartId | null
}

export function BuoyView({ telemetry, sinceHeard, held, fault, onFault, initialPart }: BuoyViewProps) {
  const { reports, latest, session } = telemetry
  const health = assess(reports.slice(-60), sinceHeard, session.interval_s)
  const [open, setOpen] = useState<PartId | null>(initialPart)
  const [asked, setAsked] = useState<ReadonlyMap<PartId, number>>(new Map())
  const [answers, setAnswers] = useState<ReadonlyMap<PartId, Answer>>(new Map())
  const simulated = session.source !== 'live'

  // An answer comes with the buoy's next report. A held sample has none, so it comes after a pause.
  useEffect(() => {
    const due = [...asked].filter(([, seq]) => held || latest.seq > seq).map(([part]) => part)
    if (due.length === 0) return
    const settle = () => {
      setAnswers((before) => new Map([...before, ...due.map((part) => [part, { ...selfTest(part, latest, fault), seq: latest.seq }] as const)]))
      setAsked((before) => new Map([...before].filter(([part]) => !due.includes(part))))
    }
    const timer = window.setTimeout(settle, held ? 900 : 0)
    return () => window.clearTimeout(timer)
  }, [asked, latest, held, fault])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const ask = (parts: readonly PartId[]) => setAsked((before) => new Map([...before, ...parts.map((part) => [part, latest.seq] as const)]))
  const fitted = health.filter((item) => item.status !== 'absent')
  const worst = (item: PartHealth): Status => (item.status === 'ok' && answers.get(item.part.id)?.passed === false ? 'fail' : item.status)
  const troubled = fitted.filter((item) => worst(item) !== 'ok')
  const tested = fitted.filter((item) => answers.has(item.part.id))
  const selected = health.find((item) => item.part.id === open)

  return (
    <div className="buoy">
      <section className="buoy__brief" aria-label="Summary">
        <h2 className="label">Buoy {latest.buoy_name}</h2>
        <p className="buoy__verdict" role="status">
          {troubled.length === 0
            ? `All ${fitted.length} fitted parts are working.`
            : `${troubled.length} of ${fitted.length} fitted parts ${troubled.length === 1 ? 'needs' : 'need'} attention: ${troubled.map((item) => item.part.name.toLowerCase()).join(', ')}.`}
        </p>
        <p className="buoy__text">
          Each dot is judged again on every report, from what the buoy sent. Nothing needs clicking. "Check status" asks the buoy to
          test the part itself; its answer comes with the next report.
        </p>
        <button className="chip chip--strong" type="button" onClick={() => ask(fitted.map((item) => item.part.id))} disabled={asked.size > 0}>
          {asked.size > 0 ? 'Asking the buoy\u2026' : 'Check all parts'}
        </button>
        <p className="buoy__text" role="status">
          {tested.length === 0
            ? 'No self-test asked yet.'
            : `Self-test: ${tested.filter((item) => answers.get(item.part.id)!.passed).length} of ${tested.length} passed, with report ${thousands(Math.max(...tested.map((item) => answers.get(item.part.id)!.seq)))}.`}
        </p>
        <ul className="legend">
          {(['ok', 'doubt', 'fail', 'silent', 'absent'] as const).map((status) => (
            <li key={status}>
              <span className="dot dot--legend" data-status={status}>
                <StatusMark status={status} />
              </span>
              {STATUS_WORD[status]}
            </li>
          ))}
        </ul>
        <p className="buoy__text">
          Green means the part reports, its reading is believable and it passed its own test. It does not mean the reading is
          accurate; that takes a calibration.
        </p>
        {simulated && (
          <label className="rehearse">
            <span className="label">Rehearse a fault</span>
            <select value={fault} onChange={(event) => onFault(event.target.value as Fault)}>
              {FAULTS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      <div className="section">
        <Section />
        {health.map((item) => (
          <button
            key={item.part.id}
            type="button"
            className="dot"
            data-status={worst(item)}
            data-asked={asked.has(item.part.id) || undefined}
            style={{ left: `${across(item.part.x)}%`, top: `${down(item.part.z)}%` }}
            aria-label={`${item.part.name}: ${STATUS_WORD[worst(item)]}`}
            title={item.part.name}
            aria-expanded={open === item.part.id}
            onClick={() => setOpen(open === item.part.id ? null : item.part.id)}
          >
            <StatusMark status={worst(item)} />
          </button>
        ))}
        <AnimatePresence>
          {selected && (
            <motion.div
              key={selected.part.id}
              className="window"
              role="dialog"
              aria-label={selected.part.name}
              style={{
                top: `${Math.min(Math.max(down(selected.part.z) - 20, 0), 44)}%`,
                ...(selected.part.x >= 0
                  ? { left: `calc(${across(selected.part.x)}% + 1.3rem)` }
                  : { right: `calc(${100 - across(selected.part.x)}% + 1.3rem)` }),
              }}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.16 }}
            >
              <header className="window__head">
                <span className="dot dot--legend" data-status={worst(selected)}>
                  <StatusMark status={worst(selected)} />
                </span>
                <div>
                  <h3>{selected.part.name}</h3>
                  <p>{STATUS_WORD[worst(selected)]}</p>
                </div>
                <button type="button" className="window__close" onClick={() => setOpen(null)} aria-label="Close">
                  ×
                </button>
              </header>
              <p className="window__what">{selected.part.what}</p>
              {selected.status !== 'absent' && (
                <>
                  <dl className="window__readings">
                    {selected.readings.map(([name, value]) => (
                      <div key={name}>
                        <dt>{name}</dt>
                        <dd className="mono">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <h4 className="label">Checked on every report</h4>
                  <ul className="window__checks">
                    {selected.checks.map((check) => (
                      <li key={check.label} data-passed={check.passed}>
                        {check.label}
                      </li>
                    ))}
                  </ul>
                  <h4 className="label">The buoy's own test</h4>
                  <p className="window__test" data-passed={answers.get(selected.part.id)?.passed}>
                    {asked.has(selected.part.id)
                      ? 'Asked. The answer comes with the next report.'
                      : answers.has(selected.part.id)
                        ? `${answers.get(selected.part.id)!.detail} With report ${thousands(answers.get(selected.part.id)!.seq)}.`
                        : 'Not asked yet.'}
                    {simulated && answers.has(selected.part.id) && !asked.has(selected.part.id) && <span> Answer of the simulated buoy.</span>}
                  </p>
                  <button className="chip" type="button" onClick={() => ask([selected.part.id])} disabled={asked.has(selected.part.id)}>
                    {asked.has(selected.part.id) ? 'Asking\u2026' : 'Check status'}
                  </button>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <section className="parts" aria-label="Parts">
        <h2 className="label">Parts, top to bottom</h2>
        <ul>
          {PARTS.map((part) => {
            const item = health.find((entry) => entry.part.id === part.id)!
            return (
              <li key={part.id}>
                <button type="button" className="parts__row" aria-pressed={open === part.id} onClick={() => setOpen(open === part.id ? null : part.id)}>
                  <span className="dot dot--legend" data-status={worst(item)}>
                    <StatusMark status={worst(item)} />
                  </span>
                  <span className="parts__name">{part.name}</span>
                  <span className="parts__value mono">{item.summary}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
