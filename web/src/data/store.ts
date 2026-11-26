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
}

export interface TelemetryStore {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => Telemetry
  /** Let the remaining reports arrive one by one. Returns a function that stops it. */
  play: (everyMs: number) => () => void
}

/** Holds a session and hands its reports to the page.
 *  Today the reports come from a file; the live stream will push into the same store. */
export function createStore(session: Session, startWith: number): TelemetryStore {
  if (session.reports.length === 0) throw new Error('a session needs at least one report')
  const listeners = new Set<() => void>()
  let shown = Math.min(Math.max(startWith, 1), session.reports.length)
  let snapshot = build()

  function build(): Telemetry {
    const reports = session.reports.slice(0, shown)
    return {
      session,
      reports,
      latest: reports[reports.length - 1]!,
      arrivedAt: Date.now(),
      complete: shown === session.reports.length,
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    play(everyMs) {
      const timer = window.setInterval(() => {
        if (shown >= session.reports.length) {
          window.clearInterval(timer)
          return
        }
        shown += 1
        snapshot = build()
        listeners.forEach((listener) => listener())
      }, everyMs)
      return () => window.clearInterval(timer)
    },
  }
}

export function useTelemetry(store: TelemetryStore): Telemetry {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
