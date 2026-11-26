import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { Mark } from './components/basics'
import { createStore, useTelemetry } from './data/store'
import type { Source } from './data/types'
import { parseSession } from './data/types'
import sessionFile from './fixtures/session.json'
import { ago } from './lib/format'
import { LiveView } from './views/LiveView'

type View = 'live' | 'data' | 'system' | 'about'
type Theme = 'light' | 'dark'

const VIEWS: readonly { id: View; label: string; planned: string }[] = [
  { id: 'live', label: 'Live', planned: '' },
  { id: 'data', label: 'Data', planned: 'History with zoom, recovered reports marked, CSV download and a printed test report.' },
  { id: 'system', label: 'System', planned: 'The bytes of the last report decoded field by field, link statistics, receiver and server.' },
  { id: 'about', label: 'About', planned: 'What the buoy is, how the data travels, what is measured and what is not.' },
]
const SOURCE_LABEL: Record<Source, string> = { live: 'Live', simulated: 'Simulated', replay: 'Replay' }

const query = new URLSearchParams(window.location.search)
/** `?still` shows the whole sample at once and holds it: used for screenshots and tests. */
const STILL = query.has('still')
const session = parseSession(sessionFile)
const store = createStore(session, STILL ? session.reports.length : 60)

function readView(): View {
  const name = window.location.hash.replace(/^#\/?/, '')
  return VIEWS.some((view) => view.id === name) ? (name as View) : 'live'
}

function readTheme(): Theme {
  const asked = query.get('theme') ?? window.localStorage.getItem('theme')
  return asked === 'dark' ? 'dark' : 'light'
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
  const now = useSeconds()

  useEffect(() => (STILL ? undefined : store.play(2000)), [])

  useEffect(() => {
    const onHash = () => setView(readView())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('theme', theme)
  }, [theme])

  const { latest } = telemetry
  const sinceHeard = STILL ? session.now - (latest.time ?? session.now) : Math.max(0, (now - telemetry.arrivedAt) / 1000)
  const planned = useMemo(() => VIEWS.find((item) => item.id === view)!, [view])
  const otherTheme: Theme = theme === 'light' ? 'dark' : 'light'

  return (
    <MotionConfig reducedMotion="user">
      <div className="sheet">
        <div className="sheet__frame">
          <div className="sheet__body">
            <header className="title">
              <a className="brand" href="#/live">
                <Mark className="brand__mark" />
                <div>
                  <h1 className="brand__name">Dhruva Setu</h1>
                  <div className="label brand__sub">Ocean observation buoy · {latest.buoy_name}</div>
                </div>
              </a>
              <nav className="nav" aria-label="Views">
                {VIEWS.map((item) => (
                  <a key={item.id} className="nav__item" href={`#/${item.id}`} aria-current={item.id === view ? 'page' : undefined}>
                    {item.label}
                    {item.id === view && (
                      <motion.span className="nav__line" layoutId="nav-line" transition={{ type: 'spring', stiffness: 520, damping: 42 }} />
                    )}
                  </a>
                ))}
              </nav>
              <div className="title__right">
                <div className="source">
                  <span className="tag" style={session.source === 'live' ? { color: 'var(--ok)' } : undefined}>
                    {SOURCE_LABEL[session.source]}
                  </span>
                  <span>{session.scenario}</span>
                </div>
                <div className="heard" role="status">
                  <motion.span
                    key={latest.seq}
                    className="heard__dot"
                    initial={{ scale: 2.2, opacity: 0.35 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.7 }}
                  />
                  heard {ago(sinceHeard)}
                </div>
                <button className="icon-button" type="button" onClick={() => setTheme(otherTheme)} aria-label={`Switch to the ${otherTheme} theme`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    {theme === 'light' ? (
                      <path d="M20 14.5 A8 8 0 1 1 9.5 4 A6.5 6.5 0 0 0 20 14.5 Z" />
                    ) : (
                      <>
                        <circle cx="12" cy="12" r="4" />
                        <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
                      </>
                    )}
                  </svg>
                </button>
              </div>
            </header>

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
                  <LiveView telemetry={telemetry} />
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
              <span>Dhruva Setu · made by Team Dhruva_1 · Smart India Hackathon 2026, PS 26065</span>
              <span>{session.source === 'live' ? '' : session.note}</span>
            </div>
          </div>
        </div>
      </div>
    </MotionConfig>
  )
}
