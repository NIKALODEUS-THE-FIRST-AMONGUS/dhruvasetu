import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { AlertBar } from './components/AlertBar'
import type { Alarm } from './components/AlertBar'
import { Step } from './components/basics'
import { TopBar } from './components/TopBar'
import type { Theme } from './components/TopBar'
import { isFault, withFault } from './data/simulatedBuoy'
import type { Fault } from './data/simulatedBuoy'
import { createStore, useTelemetry } from './data/store'
import type { Telemetry } from './data/store'
import { parseSession } from './data/types'
import sessionFile from './fixtures/session.json'
import { ago, utcTime } from './lib/format'
import { PARTS, assess } from './lib/health'
import { notices } from './lib/insight'
import { BuoyView } from './views/BuoyView'
import { LiveView } from './views/LiveView'

type View = 'live' | 'buoy' | 'data' | 'about'

const VIEWS: readonly { id: View; label: string; planned: string }[] = [
  { id: 'live', label: 'Live', planned: '' },
  { id: 'buoy', label: 'Buoy', planned: '' },
  { id: 'data', label: 'Data', planned: 'History with zoom, recovered reports marked, CSV download and a printed test report.' },
  { id: 'about', label: 'About', planned: 'What the buoy is, how the data travels, what is measured and what is not.' },
]

/** The order in which the Live view is read. The numbers match the markers on the page. */
const GUIDE: readonly { ask: string; look: string }[] = [
  { ask: 'Is it alive?', look: 'Top right: when the buoy was last heard, and whether the numbers are live, replayed or simulated.' },
  { ask: 'What is it saying?', look: 'The sentence under the title: its state, then what deserves attention. An amber rule marks the place it is talking about.' },
  { ask: 'What does it measure?', look: 'The tiles. The big number is now, the line under it says what it is doing, the curve is the last minutes.' },
  { ask: 'Where is it?', look: 'The right column: the buoy on its measured swell, its position and drift, and what happened.' },
  { ask: 'Is it healthy?', look: 'The bottom line: battery and hull, the radio link, the last report.' },
]

const query = new URLSearchParams(window.location.search)
/** `?still` shows the whole sample at once and holds it: used for screenshots and tests. */
const STILL = query.has('still')
const session = parseSession(sessionFile)
const store = createStore(session, STILL ? session.reports.length : 60)
/** `?fault=water_temp` starts with a rehearsed fault; `?part=water_temp` opens that part's window on the Buoy view. */
const askedFault = query.get('fault')
const FIRST_FAULT: Fault = isFault(askedFault) ? askedFault : 'none'
const FAULT_FROM = session.reports[STILL ? Math.max(0, session.reports.length - 9) : Math.min(61, session.reports.length - 1)]!.seq
const FIRST_PART = PARTS.find((part) => part.id === query.get('part'))?.id ?? null
/** A held page with a silent buoy stands at this many seconds without a report: past the alarm. */
const STILL_SILENCE_S = 4.5 * session.interval_s

/** A fault switched on to see what the page does. Only simulated and replayed data can have one. */
interface Rehearsal {
  kind: Fault
  /** The first report that carries the fault. */
  from: number
  /** The run of the sample in which it was switched on. */
  run: number
  /** For a silent buoy: the page as it stood when its last report arrived. */
  frozen: Telemetry | null
}

function readView(): View {
  const name = window.location.hash.replace(/^#\/?/, '')
  return VIEWS.some((view) => view.id === name) ? (name as View) : 'live'
}

/** The theme asked for in the address, else the one chosen before, else the device's own. */
function readTheme(): Theme {
  const asked = query.get('theme') ?? window.localStorage.getItem('theme')
  if (asked === 'dark' || asked === 'light') return asked
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function useSeconds(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

export default function App() {
  const telemetry = useTelemetry(store)
  const [view, setView] = useState<View>(readView)
  const [theme, setTheme] = useState<Theme>(readTheme)
  const [guide, setGuide] = useState(() => query.has('guide'))
  const [fault, setFault] = useState<Rehearsal>(() => ({
    kind: FIRST_FAULT,
    from: FAULT_FROM,
    run: 0,
    frozen: FIRST_FAULT === 'silent' ? store.getSnapshot() : null,
  }))
  const now = useSeconds()
  const otherTheme: Theme = theme === 'light' ? 'dark' : 'light'

  useEffect(() => (STILL ? undefined : store.play(2000)), [])

  useEffect(() => {
    const onHash = () => setView(readView())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === 't' || event.key === 'T') chooseTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')
      if (event.key === 'g' || event.key === 'G') setGuide((open) => !open)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function chooseTheme(next: Theme) {
    window.localStorage.setItem('theme', next)
    setTheme(next)
  }

  // A rehearsed fault changes the reports from the moment it is switched on. A silent buoy
  // changes none: the page keeps what it had and no further report reaches it.
  const shown = useMemo(() => {
    if (fault.kind === 'none') return telemetry
    if (fault.kind === 'silent') return fault.frozen ?? telemetry
    // A fault switched on in an earlier run of the sample is there from the start of this one.
    const from = telemetry.run > fault.run ? Number.NEGATIVE_INFINITY : fault.from
    const reports = telemetry.reports.map((report) => (report.seq >= from ? withFault(report, fault.kind) : report))
    return { ...telemetry, reports, latest: reports[reports.length - 1]! }
  }, [telemetry, fault])
  const { latest } = shown
  const sinceHeard = STILL
    ? fault.kind === 'silent'
      ? STILL_SILENCE_S
      : session.now - (latest.time ?? session.now)
    : Math.max(0, (now - shown.arrivedAt) / 1000)
  // The last report of a file is on the page and the sample is about to start again.
  const ended = !STILL && session.source !== 'live' && fault.kind !== 'silent' && telemetry.complete
  const planned = useMemo(() => VIEWS.find((item) => item.id === view)!, [view])
  const troubled = assess(shown.reports.slice(-60), sinceHeard, session).filter(
    (item) => item.status === 'fail' || item.status === 'doubt',
  )
  const attention = { count: troubled.length, worst: troubled.some((item) => item.status === 'fail') ? ('fail' as const) : ('doubt' as const) }
  // Whatever is an alarm goes on the red bar, on every view. The words are fixed; the detail may count.
  const alarms: Alarm[] = notices(shown.reports.slice(-60), sinceHeard, session.interval_s)
    .filter((notice) => notice.tone === 'alarm')
    .map((notice) =>
      notice.stale
        ? {
            text: 'Nothing heard from the buoy.',
            detail: `Its last report came ${ago(sinceHeard)}, at ${utcTime(latest.time)} UTC. Everything shown is that report.`,
          }
        : { text: notice.text },
    )

  return (
    <MotionConfig reducedMotion="user">
      <div className="sheet">
        <TopBar
          views={VIEWS}
          view={view}
          attention={attention}
          session={session}
          latest={latest}
          sinceHeard={sinceHeard}
          ended={ended}
          guide={guide && view === 'live'}
          guideOffered={view === 'live'}
          onGuide={() => setGuide(!guide)}
          theme={theme}
          onTheme={() => chooseTheme(otherTheme)}
        />

        <div>
          <AlertBar alarms={alarms} partsHref={view === 'buoy' ? undefined : '#/buoy'} />
          <AnimatePresence initial={false}>
            {guide && view === 'live' && (
              <motion.ol
                className="guide"
                aria-label="How to read this page"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                {GUIDE.map((step, index) => (
                  <li key={step.ask} className="guide__step">
                    <Step number={index + 1} shown />
                    <div>
                      <strong>{step.ask}</strong>
                      <p>{step.look}</p>
                    </div>
                  </li>
                ))}
              </motion.ol>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={view}
            className="view"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
          >
            {view === 'live' ? (
              <LiveView telemetry={shown} sinceHeard={sinceHeard} guide={guide} />
            ) : view === 'buoy' ? (
              <BuoyView
                telemetry={shown}
                sinceHeard={sinceHeard}
                held={STILL}
                fault={fault.kind}
                onFault={(kind) => setFault({ kind, from: latest.seq, run: telemetry.run, frozen: kind === 'silent' ? telemetry : null })}
                initialPart={FIRST_PART}
              />
            ) : (
              <section className="placeholder">
                <h2>{planned.label}</h2>
                <p>{planned.planned}</p>
                <p className="label">Planned, not built yet</p>
              </section>
            )}
          </motion.main>
        </AnimatePresence>

        <div className="credit">
          <span>Made by Team Dhruva_1 · Smart India Hackathon 2026 · PS 26065</span>
          <span>{session.source === 'live' ? '' : session.note}</span>
        </div>
      </div>
    </MotionConfig>
  )
}
