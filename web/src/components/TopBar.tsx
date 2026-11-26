import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'motion/react'
import * as Popover from '@radix-ui/react-popover'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useState } from 'react'
import type { ReactElement } from 'react'
import type { Report, Session, Source } from '../data/types'
import { ago, duration, fixed, thousands, utcTime } from '../lib/format'
import type { Status } from '../lib/health'
import { Mark, Step } from './basics'

export type Theme = 'light' | 'dark'

const SOURCE_LABEL: Record<Source, string> = { live: 'Live', simulated: 'Simulated', replay: 'Replay' }
const spring = { type: 'spring', stiffness: 520, damping: 42 } as const
const enter = {
  hidden: { opacity: 0, y: -8 },
  shown: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 380, damping: 32 } as const },
}

/** A label that appears when a control is pointed at or focused, with its key. */
function Tip({ label, keys, children }: { label: string; keys?: string; children: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tip" sideOffset={8}>
          {label}
          {keys && <kbd>{keys}</kbd>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

interface TabsProps<View extends string> {
  views: readonly { id: View; label: string }[]
  view: View
  /** Parts of the buoy that need attention: shown as a count on the Buoy tab. */
  attention: { count: number; worst: Status }
}

/** The views as one control. A pill slides to the view in use; a fainter one follows the pointer. */
function Tabs<View extends string>({ views, view, attention }: TabsProps<View>) {
  const [pointed, setPointed] = useState<View | null>(null)
  return (
    <nav className="tabs" aria-label="Views" onPointerLeave={() => setPointed(null)}>
      {views.map((item) => (
        <a
          key={item.id}
          className="tabs__item"
          href={`#/${item.id}`}
          aria-current={item.id === view ? 'page' : undefined}
          onPointerEnter={() => setPointed(item.id)}
          onFocus={() => setPointed(item.id)}
          onBlur={() => setPointed(null)}
        >
          <AnimatePresence>
            {pointed === item.id && item.id !== view && (
              <motion.span
                className="tabs__pointed"
                layoutId="tabs-pointed"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={spring}
              />
            )}
          </AnimatePresence>
          {item.id === view && <motion.span className="tabs__current" layoutId="nav-line" transition={spring} />}
          <span className="tabs__label">{item.label}</span>
          {item.id === 'buoy' && attention.count > 0 && (
            <motion.span
              className="tabs__count"
              data-status={attention.worst}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={spring}
              aria-label={`${attention.count} parts need attention`}
            >
              {attention.count}
            </motion.span>
          )}
        </a>
      ))}
    </nav>
  )
}

interface LinkStatusProps {
  session: Session
  latest: Report
  sinceHeard: number
  /** True while a sample from a file rests on its last report before it starts again. */
  ended: boolean
  /** True while the page cannot reach the database its reports come from. */
  cut: boolean
  guide: boolean
}

/** Answers "is it alive?": where the numbers come from and when the buoy was last heard.
 *  It opens to the details of the link. */
function LinkStatus({ session, latest, sinceHeard, ended, cut, guide }: LinkStatusProps) {
  const [open, setOpen] = useState(false)
  const silent = sinceHeard > 3 * session.interval_s
  const heard = ended
    ? `${session.source === 'replay' ? 'recording' : 'sample'} ended, starting again`
    : silent
      ? cut
        ? 'no connection'
        : `silent for ${duration(sinceHeard)}`
      : `heard ${ago(sinceHeard)}`
  const sent = session.received_total + session.lost_total
  const rows: [string, string][] = [
    ['Source', session.source === 'live' ? 'The shore receiver' : `${SOURCE_LABEL[session.source]}: ${session.scenario}`],
    ['Comes from', session.feed === 'hosted' ? 'the project database, as it arrives' : 'a sample file inside the page'],
    ['Last report', `${thousands(latest.seq)} at ${utcTime(latest.time)} UTC`],
    ['A report every', `${session.interval_s} s`],
    ['Not heard', `${thousands(session.lost_total)} of ${thousands(sent)}`],
    ['Signal', `${fixed(latest.rssi_dbm, 0)} dBm, SNR ${fixed(latest.snr_db, 1)} dB`],
    ['Authentication tag', latest.tag_ok === false ? 'does not match' : latest.tag_ok ? 'checked' : 'not checked'],
  ]
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <motion.button className="link" type="button" data-source={session.source} data-silent={silent || undefined} whileTap={{ scale: 0.97 }}>
          <Step number={1} shown={guide} />
          <motion.span
            key={latest.seq}
            className="heard__dot"
            initial={{ scale: 2.2, opacity: 0.35 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.7 }}
          />
          <span className="link__source">{SOURCE_LABEL[session.source]}</span>
          <span className="link__rule" />
          <span className="link__heard" role="status">
            {heard}
          </span>
          <motion.svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" animate={{ rotate: open ? 180 : 0 }} aria-hidden="true">
            <path d="M2.5 4.5 L6 8 L9.5 4.5" />
          </motion.svg>
        </motion.button>
      </Popover.Trigger>
      <AnimatePresence>
        {open && (
          <Popover.Portal forceMount>
            <Popover.Content asChild forceMount align="end" sideOffset={10}>
              <motion.div
                className="pop"
                initial={{ opacity: 0, y: -8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97, transition: { duration: 0.14 } }}
                transition={{ type: 'spring', stiffness: 460, damping: 34 }}
              >
                <h2 className="label">Where the numbers come from</h2>
                <dl>
                  {rows.map(([name, value]) => (
                    <div key={name}>
                      <dt>{name}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                {session.source !== 'live' && <p className="pop__note">{session.note}</p>}
              </motion.div>
            </Popover.Content>
          </Popover.Portal>
        )}
      </AnimatePresence>
    </Popover.Root>
  )
}

interface TopBarProps<View extends string> extends TabsProps<View> {
  session: Session
  latest: Report
  sinceHeard: number
  ended: boolean
  cut: boolean
  guide: boolean
  /** False on views that have no guide: the button is then not offered. */
  guideOffered: boolean
  onGuide: () => void
  theme: Theme
  onTheme: () => void
}

/** Title block of the page: the name, the views, the state of the link, guide and theme.
 *  It stays at the top while the page scrolls and gains a shadow once content passes under it. */
export function TopBar<View extends string>({ session, latest, sinceHeard, ended, cut, guide, guideOffered, onGuide, theme, onTheme, ...tabs }: TopBarProps<View>) {
  const [scrolled, setScrolled] = useState(false)
  const { scrollY } = useScroll()
  useMotionValueEvent(scrollY, 'change', (offset) => setScrolled(offset > 4))
  const other: Theme = theme === 'light' ? 'dark' : 'light'

  return (
    <Tooltip.Provider delayDuration={350} skipDelayDuration={200}>
      <motion.header className="topbar" data-scrolled={scrolled || undefined} initial="hidden" animate="shown" transition={{ staggerChildren: 0.07 }}>
        <motion.a className="brand" href="#/live" variants={enter}>
          <Mark className="brand__mark" />
          <div>
            <h1 className="brand__name">Dhruva Setu</h1>
            <div className="label brand__sub">Ocean observation buoy · {latest.buoy_name}</div>
          </div>
        </motion.a>

        <motion.div className="topbar__middle" variants={enter}>
          <Tabs {...tabs} />
        </motion.div>

        <motion.div className="topbar__right" variants={enter}>
          <LinkStatus session={session} latest={latest} sinceHeard={sinceHeard} ended={ended} cut={cut} guide={guide} />
          {guideOffered && (
            <Tip label="How to read this page" keys="G">
              <motion.button className="ghost" type="button" aria-pressed={guide} onClick={onGuide} whileTap={{ scale: 0.95 }}>
                <span className="ghost__icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M9.6 9.4 a2.5 2.5 0 1 1 3.7 2.2 c-0.9 0.5 -1.3 1 -1.3 1.9 M12 16.8 v0.1" />
                  </svg>
                </span>
                <span className="ghost__text">Guide</span>
              </motion.button>
            </Tip>
          )}
          <Tip label={`Switch to the ${other} theme`} keys="T">
            <motion.button className="ghost" type="button" onClick={onTheme} whileTap={{ scale: 0.95 }} aria-label={`Switch to the ${other} theme`}>
              <span className="ghost__icon">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.svg
                    key={theme}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden="true"
                    initial={{ rotate: -70, scale: 0.5, opacity: 0 }}
                    animate={{ rotate: 0, scale: 1, opacity: 1 }}
                    exit={{ rotate: 70, scale: 0.5, opacity: 0 }}
                    transition={{ duration: 0.16 }}
                  >
                    {theme === 'light' ? (
                      <path d="M20 14.5 A8 8 0 1 1 9.5 4 A6.5 6.5 0 0 0 20 14.5 Z" />
                    ) : (
                      <>
                        <circle cx="12" cy="12" r="4" />
                        <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
                      </>
                    )}
                  </motion.svg>
                </AnimatePresence>
              </span>
              <span className="ghost__text">{other === 'dark' ? 'Dark' : 'Light'}</span>
            </motion.button>
          </Tip>
        </motion.div>
      </motion.header>
    </Tooltip.Provider>
  )
}
