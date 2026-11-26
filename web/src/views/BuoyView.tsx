import * as Popover from '@radix-ui/react-popover'
import * as Select from '@radix-ui/react-select'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import * as Tooltip from '@radix-ui/react-tooltip'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { FAULTS, selfTest } from '../data/simulatedBuoy'
import type { Fault, SelfTest } from '../data/simulatedBuoy'
import type { Telemetry } from '../data/store'
import { thousands } from '../lib/format'
import { STATUS_WORD, assess } from '../lib/health'
import type { PartHealth, PartId, Status } from '../lib/health'

/** The section is drawn in millimetres: x from the axis, z above the keel plate. */
const LEFT = -235
const WIDTH = 470
const TOP = 475
const HEIGHT = 570
const WATERLINE = 177
const across = (x: number) => ((x - LEFT) / WIDTH) * 100
const down = (z: number) => ((TOP - z) / HEIGHT) * 100
const spring = { type: 'spring', stiffness: 460, damping: 34 } as const

const mirror = (half: readonly (readonly [number, number])[]) =>
  [...half, ...[...half].reverse().map(([r, z]) => [-r, z] as const)].map(([r, z]) => `${r},${-z}`).join(' ')
// The can and cone are bolted through flanges that turn inward: the outside has no step (keel can: dia 220 over all).
const OUTSIDE = mirror([[104, 0], [110, 6], [110, 80], [160, 187.2], [160, 248.2], [146, 248.2], [60, 338.2]])
const BELOW_DECK = mirror([[106, 6], [106, 68], [88, 68], [88, 90], [110.3, 90], [153.2, 182.2], [128, 182.2], [128, 187.2]])
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

/** The state of a part as a word in its colour. */
function Badge({ status }: { status: Status }) {
  return (
    <span className="badge" data-status={status}>
      <StatusMark status={status} />
      {STATUS_WORD[status]}
    </span>
  )
}

const RING_RADIUS = 34
const RING_LENGTH = 2 * Math.PI * RING_RADIUS
const RING_ORDER = ['ok', 'doubt', 'fail', 'silent'] as const

/** How many fitted parts are in each state, as one ring. */
function HealthRing({ states }: { states: readonly Status[] }) {
  const lengths = RING_ORDER.map((status) =>
    states.length ? (states.filter((state) => state === status).length / states.length) * RING_LENGTH : 0,
  )
  const arcs = RING_ORDER.map((status, index) => ({
    status,
    length: lengths[index]!,
    start: lengths.slice(0, index).reduce((sum, length) => sum + length, 0),
  }))
  return (
    <svg className="ring" viewBox="0 0 88 88" role="img" aria-label={`${states.filter((state) => state === 'ok').length} of ${states.length} fitted parts working`}>
      <circle className="ring__track" cx="44" cy="44" r={RING_RADIUS} />
      {arcs.map((arc) => (
        <motion.circle
          key={arc.status}
          className="ring__arc"
          data-status={arc.status}
          cx="44"
          cy="44"
          r={RING_RADIUS}
          transform="rotate(-90 44 44)"
          initial={false}
          animate={{ strokeDasharray: `${arc.length} ${RING_LENGTH - arc.length}`, strokeDashoffset: -arc.start }}
          transition={{ type: 'spring', stiffness: 120, damping: 22 }}
        />
      ))}
      <text className="ring__count" x="44" y="45">
        {states.filter((state) => state === 'ok').length}
      </text>
      <text className="ring__of" x="44" y="58">
        of {states.length}
      </text>
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
  const [shown, setShown] = useState<'all' | 'attention'>('all')
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

  const ask = (parts: readonly PartId[]) => setAsked((before) => new Map([...before, ...parts.map((part) => [part, latest.seq] as const)]))
  const worst = (item: PartHealth): Status => (item.status === 'ok' && answers.get(item.part.id)?.passed === false ? 'fail' : item.status)
  const fitted = health.filter((item) => item.status !== 'absent')
  const troubled = fitted.filter((item) => worst(item) !== 'ok')
  const tested = fitted.filter((item) => answers.has(item.part.id))
  const listed = shown === 'attention' ? troubled : health

  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={150}>
      <div className="buoy">
        <aside className="buoy__brief" aria-label="Summary">
          <div className="card summary">
            <HealthRing states={fitted.map(worst)} />
            <div>
              <h2 className="label">Buoy {latest.buoy_name}</h2>
              <p className="buoy__verdict" role="status">
                {troubled.length === 0
                  ? `All ${fitted.length} fitted parts are working.`
                  : `${troubled.length} of ${fitted.length} fitted parts ${troubled.length === 1 ? 'needs' : 'need'} attention.`}
              </p>
            </div>
          </div>

          <div className="buoy__actions">
            <motion.button className="button" type="button" whileTap={{ scale: 0.97 }} onClick={() => ask(fitted.map((item) => item.part.id))} disabled={asked.size > 0}>
              {asked.size > 0 && (
                <motion.svg className="button__spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }} aria-hidden="true">
                  <path d="M8 2 a6 6 0 1 1 -6 6" />
                </motion.svg>
              )}
              {asked.size > 0 ? 'Asking the buoy' : 'Check all parts'}
            </motion.button>
            <p className="buoy__text" role="status">
              {tested.length === 0
                ? 'No self-test asked yet.'
                : `Self-test: ${tested.filter((item) => answers.get(item.part.id)!.passed).length} of ${tested.length} passed, with report ${thousands(Math.max(...tested.map((item) => answers.get(item.part.id)!.seq)))}.`}
            </p>
          </div>

          <div className="card note">
            <h3 className="label">How to read the dots</h3>
            <p>
              Every dot is judged again on each report, with no clicking. "Check status" asks the buoy to test the part itself; the
              answer comes with its next report.
            </p>
            <p>
              Green means the part reports, its reading is believable and it passed its own test. It does not mean the reading is
              accurate; that takes a calibration.
            </p>
            <ul className="legend">
              {(['ok', 'doubt', 'fail', 'silent', 'absent'] as const).map((status) => (
                <li key={status}>
                  <Badge status={status} />
                </li>
              ))}
            </ul>
          </div>

          {simulated && (
            <div className="rehearse">
              <span className="label" id="rehearse-label">
                Rehearse a fault
              </span>
              <Select.Root value={fault} onValueChange={(value) => onFault(value as Fault)}>
                <Select.Trigger className="select" aria-labelledby="rehearse-label">
                  <Select.Value />
                  <Select.Icon>
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                      <path d="M2.5 4.5 L6 8 L9.5 4.5" />
                    </svg>
                  </Select.Icon>
                </Select.Trigger>
                <Select.Portal>
                  <Select.Content className="pop select__list" position="popper" sideOffset={6}>
                    <Select.Viewport>
                      {FAULTS.map((item) => (
                        <Select.Item key={item.id} value={item.id} className="select__item">
                          <Select.ItemText>{item.label}</Select.ItemText>
                          <Select.ItemIndicator>
                            <StatusMark status="ok" />
                          </Select.ItemIndicator>
                        </Select.Item>
                      ))}
                    </Select.Viewport>
                  </Select.Content>
                </Select.Portal>
              </Select.Root>
            </div>
          )}
        </aside>

        <div className="section">
          <Section />
          {health.map((item) => {
            const status = worst(item)
            const isOpen = open === item.part.id
            const answer = answers.get(item.part.id)
            const waiting = asked.has(item.part.id)
            return (
              <Popover.Root key={item.part.id} open={isOpen} onOpenChange={(next) => setOpen(next ? item.part.id : null)}>
                <span className="spot" style={{ left: `${across(item.part.x)}%`, top: `${down(item.part.z)}%` }}>
                  {(status === 'fail' || status === 'doubt') && (
                    <motion.span
                      className="spot__pulse"
                      data-status={status}
                      animate={{ scale: [1, 2.1], opacity: [0.55, 0] }}
                      transition={{ repeat: Infinity, duration: 1.6, ease: 'easeOut' }}
                    />
                  )}
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Popover.Trigger asChild>
                        <motion.button
                          type="button"
                          className="dot"
                          data-status={status}
                          data-asked={waiting || undefined}
                          aria-label={`${item.part.name}: ${STATUS_WORD[status]}`}
                          whileHover={{ scale: 1.15 }}
                          whileTap={{ scale: 0.92 }}
                          transition={spring}
                        >
                          <StatusMark status={status} />
                        </motion.button>
                      </Popover.Trigger>
                    </Tooltip.Trigger>
                    {!isOpen && (
                      <Tooltip.Portal>
                        <Tooltip.Content className="tip" sideOffset={8}>
                          {item.part.name}
                        </Tooltip.Content>
                      </Tooltip.Portal>
                    )}
                  </Tooltip.Root>
                </span>
                <AnimatePresence>
                  {isOpen && (
                    <Popover.Portal forceMount>
                      <Popover.Content
                        asChild
                        forceMount
                        side={item.part.x >= 0 ? 'right' : 'left'}
                        sideOffset={14}
                        collisionPadding={12}
                        onOpenAutoFocus={(event) => event.preventDefault()}
                      >
                        <motion.div
                          className="pop part"
                          initial={{ opacity: 0, scale: 0.94 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.12 } }}
                          transition={spring}
                        >
                          <header className="part__head">
                            <div>
                              <h3>{item.part.name}</h3>
                              <p>{item.part.what}</p>
                            </div>
                            <Popover.Close className="part__close" aria-label="Close">
                              ×
                            </Popover.Close>
                          </header>
                          <Badge status={status} />
                          {status !== 'absent' && (
                            <>
                              <dl className="part__readings">
                                {item.readings.map(([name, value]) => (
                                  <div key={name}>
                                    <dt>{name}</dt>
                                    <dd className="mono">{value}</dd>
                                  </div>
                                ))}
                              </dl>
                              <h4 className="label">Checked on every report</h4>
                              <ul className="part__checks">
                                {item.checks.map((check) => (
                                  <li key={check.label} data-passed={check.passed}>
                                    {check.label}
                                  </li>
                                ))}
                              </ul>
                              <h4 className="label">The buoy's own test</h4>
                              <p className="part__test" data-passed={answer?.passed}>
                                {waiting
                                  ? 'Asked. The answer comes with the next report.'
                                  : answer
                                    ? `${answer.detail} With report ${thousands(answer.seq)}.`
                                    : 'Not asked yet.'}
                                {simulated && answer && !waiting && <span> Answer of the simulated buoy.</span>}
                              </p>
                              <motion.button className="button button--quiet" type="button" whileTap={{ scale: 0.97 }} onClick={() => ask([item.part.id])} disabled={waiting}>
                                {waiting ? 'Asking' : 'Check status'}
                              </motion.button>
                            </>
                          )}
                          <Popover.Arrow className="pop__arrow" width={14} height={7} />
                        </motion.div>
                      </Popover.Content>
                    </Popover.Portal>
                  )}
                </AnimatePresence>
              </Popover.Root>
            )
          })}
        </div>

        <section className="parts" aria-label="Parts">
          <div className="parts__head">
            <h2 className="label">Parts</h2>
            <ToggleGroup.Root className="seg" type="single" value={shown} onValueChange={(value) => value && setShown(value as 'all' | 'attention')} aria-label="Which parts to list">
              <ToggleGroup.Item className="seg__item" value="all">
                All <span>{health.length}</span>
              </ToggleGroup.Item>
              <ToggleGroup.Item className="seg__item" value="attention">
                Attention <span data-some={troubled.length > 0 || undefined}>{troubled.length}</span>
              </ToggleGroup.Item>
            </ToggleGroup.Root>
          </div>
          <ul className="parts__list">
            <AnimatePresence initial={false} mode="popLayout">
              {listed.map((item) => (
                <motion.li key={item.part.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring}>
                  <button type="button" className="parts__row" data-open={open === item.part.id || undefined} onClick={() => setOpen(item.part.id)}>
                    <span className="dot dot--small" data-status={worst(item)}>
                      <StatusMark status={worst(item)} />
                    </span>
                    <span className="parts__name">{item.part.name}</span>
                    {worst(item) === 'ok' || worst(item) === 'absent' ? (
                      <span className="parts__value mono">{item.summary}</span>
                    ) : (
                      <span className="parts__value">
                        <Badge status={worst(item)} />
                      </span>
                    )}
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          {listed.length === 0 && <p className="parts__none">Nothing needs attention.</p>}
        </section>
      </div>
    </Tooltip.Provider>
  )
}
