import { AnimatePresence, motion } from 'motion/react'

export interface Alarm {
  /** What is wrong, in words that do not change from second to second. */
  text: string
  /** What follows from it, or how long it has lasted. May change every second. */
  detail?: string
}

interface AlertBarProps {
  /** Empty: there is no bar. */
  alarms: readonly Alarm[]
  /** Where the parts can be looked at, when the viewer is not there already. */
  partsHref?: string
}

/** A red bar across the page whenever something is wrong: nothing heard from the buoy,
 *  water inside the hull, a report that is not the buoy's own. It shows on every view. */
export function AlertBar({ alarms, partsHref }: AlertBarProps) {
  return (
    <AnimatePresence initial={false}>
      {alarms.length > 0 && (
        <motion.div
          className="alert"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="alert__row">
            <motion.svg
              className="alert__sign"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              animate={{ opacity: [1, 0.45, 1] }}
              transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
            >
              <path d="M12 3.5 L22 20.5 H2 Z" />
              <path d="M12 10 V14.5 M12 17.6 V17.8" />
            </motion.svg>
            <strong className="alert__word">Alert</strong>
            {/* The words are announced once. The detail may count seconds, so it is kept out of the announcement. */}
            <p className="alert__text" role="alert">
              {alarms.map((alarm) => alarm.text).join(' ')}
            </p>
            <p className="alert__detail" aria-live="off">
              {alarms
                .map((alarm) => alarm.detail)
                .filter(Boolean)
                .join(' ')}
            </p>
            {partsHref && (
              <a className="alert__link" href={partsHref}>
                See the parts
              </a>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
