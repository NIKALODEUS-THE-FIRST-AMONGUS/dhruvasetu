import { useSyncExternalStore } from 'react'
import type { Report, Session } from './types'

export interface Telemetry {
  session: Session
  /** Reports heard so far, oldest first. */
  reports: Report[]
  latest: Report
  /** Wall-clock milliseconds at which the latest report reached the page. */
  arrivedAt: number
  /** True when every report of a file is already on the page. */
  complete: boolean
  /** Counts every fresh start: a sample that began again, or a stream taken up from the database. */
  run: number
  /** True while the page cannot reach the database its reports come from. A file is never cut off. */
  cut: boolean
}

export interface TelemetryStore {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => Telemetry
  /** Let the remaining reports of the file arrive one by one. A sample from a file starts again a
   *  few moments after its last report: the end of a file is not a silent buoy, and the page
   *  must not raise that alarm for it. Returns a function that stops the playing. */
  play: (everyMs: number) => () => void
  /** Take up a stream from the database. Its reports take the place of the file's, and the file rests. */
  adopt: (session: Session, reports: Report[], arrivedAt: number) => void
  /** One more report from the database. */
  push: (report: Report, arrivedAt?: number) => void
  /** Say whether the database can be reached. */
  setCut: (cut: boolean) => void
}

/** Ticks to rest on the last report of a sample before it starts again. */
const REST_TICKS = 3
/** Reports from the database kept on the page: two hours at one every ten seconds. */
const KEPT = 720
/** The report counter is two bytes long. */
const COUNTER = 65_536

/** Holds the reports the page shows and hands them on as they come.
 *  They come from a file built into the page until a stream from the database is taken up. */
export function createStore(sample: Session, startWith: number): TelemetryStore {
  if (sample.reports.length === 0) throw new Error('a session needs at least one report')
  const listeners = new Set<() => void>()
  const first = Math.min(Math.max(startWith, 1), sample.reports.length)
  let shown = first
  let run = 0
  let rested = 0
  let cut = false
  let hosted: { session: Session; reports: Report[]; arrivedAt: number } | null = null
  let snapshot = build()

  function build(): Telemetry {
    if (hosted) {
      return { ...hosted, latest: hosted.reports[hosted.reports.length - 1]!, complete: false, run, cut }
    }
    const reports = sample.reports.slice(0, shown)
    return {
      session: sample,
      reports,
      latest: reports[reports.length - 1]!,
      arrivedAt: Date.now(),
      complete: shown === sample.reports.length,
      run,
      cut: false,
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
        if (hosted) return
        if (shown < sample.reports.length) {
          shown += 1
          publish()
          return
        }
        // The file has run out. A live stream has no end to start again from.
        if (sample.source === 'live' || first === sample.reports.length) return
        rested += 1
        if (rested < REST_TICKS) return
        rested = 0
        run += 1
        shown = first
        publish()
      }, everyMs)
      return () => clearInterval(timer)
    },
    adopt(session, reports, arrivedAt) {
      if (reports.length === 0) throw new Error('a stream is taken up with at least one report')
      hosted = { session: { ...session, feed: 'hosted' }, reports: reports.slice(-KEPT), arrivedAt }
      run += 1
      cut = false
      publish()
    },
    push(report, arrivedAt = Date.now()) {
      if (!hosted) return
      const previous = hosted.reports[hosted.reports.length - 1]!
      if (report.seq === previous.seq && report.time === previous.time) return
      // The counter tells how many reports were missed; a late one from the buoy's store fills a gap.
      const step = (report.seq - previous.seq + COUNTER) % COUNTER
      const lost = report.recovered ? -Math.min(hosted.session.lost_total, 1) : step >= 2 && step <= 1000 ? step - 1 : 0
      hosted = {
        session: { ...hosted.session, received_total: hosted.session.received_total + 1, lost_total: hosted.session.lost_total + lost },
        reports: [...hosted.reports, report].slice(-KEPT),
        arrivedAt,
      }
      cut = false
      publish()
    },
    setCut(next) {
      if (!hosted || cut === next) return
      cut = next
      publish()
    },
  }
}

export function useTelemetry(store: TelemetryStore): Telemetry {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
