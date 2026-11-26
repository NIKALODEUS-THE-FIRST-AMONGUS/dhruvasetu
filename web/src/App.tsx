import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { Step } from './components/basics'
import { TopBar } from './components/TopBar'
import type { Theme } from './components/TopBar'
import { isFault, withFault } from './data/simulatedBuoy'
import type { Fault } from './data/simulatedBuoy'
import { createStore, useTelemetry } from './data/store'
import { parseSession } from './data/types'
import sessionFile from './fixtures/session.json'
import { PARTS, assess } from './lib/health'
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
  const [fault, setFault] = useState({ kind: FIRST_FAULT, from: FAULT_FROM })
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

  // A rehearsed fault changes the reports from the moment it is switched on.
  const shown = useMemo(() => {
    if (fault.kind === 'none') return telemetry
    const reports = telemetry.reports.map((report) => (report.seq >= fault.from ? withFault(report, fault.kind) : report))
    return { ...telemetry, reports, latest: reports[reports.length - 1]! }
  }, [telemetry, fault])
  const { latest } = shown
  const sinceHeard = STILL ? session.now - (latest.time ?? session.now) : Math.max(0, (now - telemetry.arrivedAt) / 1000)
  const planned = useMemo(() => VIEWS.find((item) => item.id === view)!, [view])
  const troubled = assess(shown.reports.slice(-60), sinceHeard, session.interval_s).filter(
    (item) => item.status === 'fail' || item.status === 'doubt',
  )
  const attention = { count: troubled.length, worst: troubled.some((item) => item.status === 'fail') ? ('fail' as const) : ('doubt' as const) }

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
          guide={guide && view === 'live'}
          guideOffered={view === 'live'}
          onGuide={() => setGuide(!guide)}
          theme={theme}
          onTheme={() => chooseTheme(otherTheme)}
        />

        <div>
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
                onFault={(kind) => setFault({ kind, from: latest.seq })}
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
