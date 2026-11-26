import * as Popover from '@radix-ui/react-popover'
import * as Select from '@radix-ui/react-select'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import * as Tooltip from '@radix-ui/react-tooltip'
import { AnimatePresence, motion, useAnimationFrame, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { FAULTS, selfTest } from '../data/simulatedBuoy'
import type { Fault, SelfTest } from '../data/simulatedBuoy'
import type { Telemetry } from '../data/store'
import type { BuoyState } from '../data/types'
import { duration, fixed, thousands } from '../lib/format'
import { STATUS_WORD, assess } from '../lib/health'
import type { PartHealth, PartId, Status } from '../lib/health'

/** The section is drawn in millimetres: x from the axis, z above the keel plate.
 *  Above the antenna and below the feet there is room for the hull to rise and fall. */
const LEFT = -235
const WIDTH = 470
const TOP = 500
const HEIGHT = 610
const BOTTOM = HEIGHT - TOP
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

/** The swell as the Live view draws it, brought to this drawing's millimetres. There, one
 *  millimetre of hull is 0.33 px, the swell is 560 px long and rises 4 px and 5 px more for
 *  each metre of wave height, between 2.5 and 20 px. Here the hull travels half as far for
 *  its size: this drawing is there to be read. */
const LIVE_PX_PER_MM = 0.33
const TRAVEL = 0.5
const SWELL_LENGTH = 560 / LIVE_PX_PER_MM
const FLAT_SEA = `M${LEFT} ${-WATERLINE} L${LEFT + WIDTH} ${-WATERLINE}`
/** Milliseconds in which the hull comes to rest, or takes up the swell again. */
const SETTLE_MS = 350

interface Swell {
  waveHeightM: number | null
  wavePeriodS: number | null
  tiltDeg: number | null
  state: BuoyState
}

interface Riding {
  sea: RefObject<SVGPathElement | null>
  surface: RefObject<SVGPathElement | null>
  hull: RefObject<SVGGElement | null>
  riders: RefObject<HTMLDivElement | null>
}

/** Moves the sea, the hull and the layer of dots by the swell the buoy reports: its height,
 *  its period and the mean tilt. While `rest` is true everything comes to rest, flat and
 *  upright, so that a part can be pointed at and its window read. A device that asks for
 *  no motion gets the picture at rest. */
function useSwell({ waveHeightM, wavePeriodS, tiltDeg, state }: Swell, rest: boolean): Riding {
  const still = useReducedMotion()
  const sea = useRef<SVGPathElement>(null)
  const surface = useRef<SVGPathElement>(null)
  const hull = useRef<SVGGElement>(null)
  const riders = useRef<HTMLDivElement>(null)
  const share = useRef(0)
  const lastFrame = useRef(0)
  const atRest = useRef(true)

  const frozen = state === 'ICE'
  const amplitude = (TRAVEL * (frozen ? 1.2 : Math.min(20, Math.max(2.5, 4 + 5 * (waveHeightM ?? 0))))) / LIVE_PX_PER_MM
  const period = Math.max(2, wavePeriodS ?? 8)
  const tilt = frozen ? 0 : tiltDeg ?? 0

  const draw = useCallback(
    (seconds: number, part: number) => {
      const k = (2 * Math.PI) / SWELL_LENGTH
      const omega = (2 * Math.PI) / period
      const height = amplitude * part
      // How far the surface stands below the still waterline at x, in millimetres.
      const drop = (x: number) => height * Math.sin(k * x - omega * seconds) + 0.28 * height * Math.sin(2.3 * k * x - 1.7 * omega * seconds + 1.3)
      let line = ''
      for (let x = LEFT; x <= LEFT + WIDTH; x += 10) line += `${x === LEFT ? 'M' : 'L'}${x} ${(drop(x) - WATERLINE).toFixed(1)} `
      surface.current?.setAttribute('d', line)
      sea.current?.setAttribute('d', `${line}L${LEFT + WIDTH} ${BOTTOM} L${LEFT} ${BOTTOM} Z`)
      const slope = Math.cos(-omega * seconds) + 0.644 * Math.cos(-1.7 * omega * seconds + 1.3)
      const lean = (part * tilt * slope) / 1.644
      const heave = drop(0)
      hull.current?.setAttribute('transform', `translate(0 ${heave.toFixed(2)}) rotate(${lean.toFixed(2)} 0 ${-WATERLINE})`)
      if (riders.current) riders.current.style.transform = `translateY(${((heave / HEIGHT) * 100).toFixed(3)}%) rotate(${lean.toFixed(2)}deg)`
    },
    [amplitude, period, tilt],
  )

  useEffect(() => {
    if (still) draw(0, 0)
  }, [still, draw])

  useAnimationFrame((time, delta) => {
    if (still) return
    const wanted = rest ? 0 : 1
    share.current += (wanted - share.current) * (1 - Math.exp(-delta / SETTLE_MS))
    if (time - lastFrame.current < 33) return
    const resting = wanted === 0 && share.current < 0.002
    if (resting && atRest.current) return
    lastFrame.current = time
    draw(time / 1000, resting ? 0 : share.current)
    atRest.current = resting
  })

  return { sea, surface, hull, riders }
}

interface SectionProps {
  riding: Riding
  /** Changes with every report: sends a ring out from the antenna. */
  pulse: number
  /** What moves the drawing, in words. */
  caption: string
}

/** Section through the axis of hull H3, from the parameters of the Fusion model.
 *  Where each sensor sits follows the sensor proposal of the project file; none is built yet. */
function Section({ riding, pulse, caption }: SectionProps) {
  return (
    <svg
      className="section__drawing"
      viewBox={`${LEFT} ${-TOP} ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Section through the buoy showing where each part sits. Sea: ${caption}.`}
    >
      <path ref={riding.sea} className="section__sea" d={`${FLAT_SEA} L${LEFT + WIDTH} ${BOTTOM} L${LEFT} ${BOTTOM} Z`} />
      <path ref={riding.surface} className="section__surface" d={FLAT_SEA} />
      <g ref={riding.hull}>
        <line className="section__line" x1={0} y1={-338.2} x2={0} y2={-450} />
        <circle className="section__metal" cx={0} cy={-450} r={3} />
        <motion.circle
          key={pulse}
          className="section__ping"
          cx={0}
          cy={-450}
          initial={{ r: 4, opacity: 0.85 }}
          animate={{ r: 44, opacity: 0 }}
          transition={{ duration: 1.9, ease: 'easeOut' }}
        />
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
      </g>
      <text className="section__note" x={LEFT + 8} y={BOTTOM - 10}>
        {caption}
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

/** The outcome of one check, as a sign for the eye and a word for a screen reader. */
function outcome(passed: boolean | null): { sign: 'pass' | 'fail' | 'none'; word: string } {
  if (passed === null) return { sign: 'none', word: 'Not checked' }
  return passed ? { sign: 'pass', word: 'Passed' } : { sign: 'fail', word: 'Failed' }
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
  const health = assess(reports.slice(-60), sinceHeard, session)
  /** Nothing heard for three intervals: what the page holds is the last report, and no question can be put. */
  const silent = sinceHeard > 3 * session.interval_s
  const [open, setOpen] = useState<PartId | null>(initialPart)
  /** The view itself: a part's window stays inside it, clear of the top bar and the credit line. */
  const [frame, setFrame] = useState<HTMLDivElement | null>(null)
  const [shown, setShown] = useState<'all' | 'attention'>('all')
  const [asked, setAsked] = useState<ReadonlyMap<PartId, number>>(new Map())
  const [answers, setAnswers] = useState<ReadonlyMap<PartId, Answer>>(new Map())
  const simulated = session.source !== 'live'

  // An answer comes with the buoy's next report. A held sample has none, so it comes after a pause.
  useEffect(() => {
    const due = [...asked].filter(([, seq]) => held || latest.seq !== seq).map(([part]) => part)
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
  const troubled = fitted.filter((item) => worst(item) === 'fail' || worst(item) === 'doubt')

  // The drawing rides the reported swell. It rests while it is pointed at, while a dot has
  // the keyboard, and while a window is open: a moving target is hard to hit and to read.
  const [pointed, setPointed] = useState(false)
  const [focused, setFocused] = useState(false)
  const riding = useSwell(
    { waveHeightM: latest.wave_hs_m, wavePeriodS: latest.wave_tp_s, tiltDeg: latest.tilt_deg, state: latest.state },
    open !== null || pointed || focused,
  )
  const sea =
    latest.state === 'ICE'
      ? 'held in ice'
      : latest.wave_hs_m === null
        ? 'no wave data'
        : `swell of ${fixed(latest.wave_hs_m, 2)} m every ${fixed(latest.wave_tp_s, 1)} s`
  const caption = silent ? `last known: ${sea}` : sea
  const tested = fitted.filter((item) => answers.has(item.part.id))
  const listed = shown === 'attention' ? troubled : health

  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={150}>
      <div className="buoy" ref={setFrame}>
        <aside className="buoy__brief" aria-label="Summary">
          <div className="card summary">
            <HealthRing states={fitted.map(worst)} />
            <div>
              <h2 className="label">Buoy {latest.buoy_name}</h2>
              <p className="buoy__verdict" role="status">
                {silent
                  ? `Nothing heard for ${duration(sinceHeard)}. The parts cannot be judged until a report arrives.`
                  : troubled.length === 0
                    ? `All ${fitted.length} fitted parts are working.`
                    : `${troubled.length} of ${fitted.length} fitted parts ${troubled.length === 1 ? 'needs' : 'need'} attention.`}
              </p>
            </div>
          </div>

          <div className="buoy__actions">
            <motion.button className="button" type="button" whileTap={{ scale: 0.97 }} onClick={() => ask(fitted.map((item) => item.part.id))} disabled={asked.size > 0 || silent}>
              {asked.size > 0 && (
                <motion.svg className="button__spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }} aria-hidden="true">
                  <path d="M8 2 a6 6 0 1 1 -6 6" />
                </motion.svg>
              )}
              {asked.size > 0 ? 'Asking the buoy' : 'Check all parts'}
            </motion.button>
            <p className="buoy__text" role="status">
              {silent
                ? 'The buoy can be asked again once a report is heard.'
                : tested.length === 0
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
            <p>The buoy rides the swell it reports. It comes to rest while you point at it or open a part.</p>
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

        <div
          className="section"
          onPointerEnter={() => setPointed(true)}
          onPointerLeave={() => setPointed(false)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        >
          <Section riding={riding} pulse={latest.seq} caption={caption} />
          <div className="section__riders" ref={riding.riders} style={{ transformOrigin: `${across(0)}% ${down(WATERLINE)}%` }}>
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
                          collisionBoundary={frame}
                          collisionPadding={8}
                          updatePositionStrategy="always"
                          onOpenAutoFocus={(event) => event.preventDefault()}
                        >
                          <motion.div
                            className="pop part"
                            data-stale={silent || undefined}
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
                                {silent && <p className="part__stale">Nothing heard for {duration(sinceHeard)}. What follows is the last report.</p>}
                                <dl className="part__readings">
                                  {item.readings.map(([name, value]) => (
                                    <div key={name}>
                                      <dt>{name}</dt>
                                      <dd className="mono">{value}</dd>
                                    </div>
                                  ))}
                                </dl>
                                <h4 className="label">{silent ? 'Checked on the last report' : 'Checked on every report'}</h4>
                                <ul className="part__checks">
                                  {item.checks.map((check) => (
                                    <li key={check.label} data-result={outcome(check.passed).sign}>
                                      <span className="sr-only">{outcome(check.passed).word}: </span>
                                      {check.label}
                                    </li>
                                  ))}
                                </ul>
                                {item.checks.some((check) => check.passed === null) && (
                                  <p className="part__hint">A dash: not checked, because what it needs was not sent.</p>
                                )}
                                <h4 className="label">The buoy's own test</h4>
                                <p className="part__test" data-passed={answer?.passed}>
                                  {waiting
                                    ? 'Asked. The answer comes with the next report.'
                                    : answer
                                      ? `${answer.detail} With report ${thousands(answer.seq)}.`
                                      : silent
                                        ? 'Not asked. It can be asked once a report is heard.'
                                        : 'Not asked yet.'}
                                  {simulated && answer && !waiting && <span> Answer of the simulated buoy.</span>}
                                </p>
                                <motion.button className="button button--quiet" type="button" whileTap={{ scale: 0.97 }} onClick={() => ask([item.part.id])} disabled={waiting || silent}>
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
