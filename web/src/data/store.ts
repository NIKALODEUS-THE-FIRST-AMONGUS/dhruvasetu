import { useSyncExternalStore } from 'react'
import type { Report, Session } from './types'

export interface Telemetry {
  session: Session
  /** Reports heard so far, oldest first. */
  reports: Report[]
  latest: Report
  /** Wall-clock milliseconds at which the latest report reached the page. */
  arrivedAt: number
  /** True when every report of the session is already on the page. */
  complete: boolean
  /** How many times the sample has started again from its beginning. */
  run: number
}

export interface TelemetryStore {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => Telemetry
  /** Let the remaining reports arrive one by one. A sample from a file starts again a few
   *  moments after its last report: the end of a file is not a silent buoy, and the page
   *  must not raise that alarm for it. Returns a function that stops the playing. */
  play: (everyMs: number) => () => void
}

/** Ticks to rest on the last report of a sample before it starts again. */
const REST_TICKS = 3

/** Holds a session and hands its reports to the page.
 *  Today the reports come from a file; the live stream will push into the same store. */
export function createStore(session: Session, startWith: number): TelemetryStore {
  if (session.reports.length === 0) throw new Error('a session needs at least one report')
  const listeners = new Set<() => void>()
  const first = Math.min(Math.max(startWith, 1), session.reports.length)
  let shown = first
  let run = 0
  let rested = 0
  let snapshot = build()

  function build(): Telemetry {
    const reports = session.reports.slice(0, shown)
    return {
      session,
      reports,
      latest: reports[reports.length - 1]!,
      arrivedAt: Date.now(),
      complete: shown === session.reports.length,
      run,
    }
  }

  function publish() {
    snapshot = build()
    listeners.forEach((listener) => listener())
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    play(everyMs) {
      const timer = setInterval(() => {
        if (shown < session.reports.length) {
          shown += 1
          publish()
          return
        }
        // The file has run out. A live stream has no end to start again from.
        if (session.source === 'live' || first === session.reports.length) return
        rested += 1
        if (rested < REST_TICKS) return
        rested = 0
        run += 1
        shown = first
        publish()
      }, everyMs)
      return () => clearInterval(timer)
    },
  }
}

export function useTelemetry(store: TelemetryStore): Telemetry {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
