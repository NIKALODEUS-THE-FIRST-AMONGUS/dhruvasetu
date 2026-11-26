/** Following the reports in the project's database.
 *
 *  The page asks once for the latest reports, then listens for new ones. Whenever the
 *  listening is established again it asks for what it missed. And when nothing has come
 *  for three intervals it asks the database itself: its answer tells a buoy that has
 *  fallen silent from a page that has lost its connection, which are different things
 *  and are said differently on the page. */
import type { TelemetryStore } from './store'
import { parseReport } from './types'
import type { Report, Session } from './types'

export interface StreamItem {
  id: number
  /** When the database stored the report, in milliseconds on its own clock. */
  received_ms: number
  report: unknown
  /** Present on reports that arrive by themselves; those asked for are of one source already. */
  source?: string
}

/** What `public.stream` of the database answers. */
export interface StreamAnswer {
  /** The time on the database's clock: ages are worked out against it, not against this computer's. */
  now_ms: number
  source: string | null
  buoy: { buoy: number; name: string; scenario: string; interval_s: number; spreading_factor: number } | null
  link: { received_total: number; lost_total: number } | null
  reports: StreamItem[]
}

export interface Transport {
  /** The latest reports, or those after an id. Rejects when the database cannot be reached. */
  stream: (after: number | null) => Promise<StreamAnswer>
  /** Calls back for every new report, and each time the listening is (re)established. Returns a function that ends it. */
  listen: (onItem: (item: StreamItem) => void, onJoined: () => void) => () => void
}

/** Time on air of one LoRa packet with header and CRC at 125 kHz and coding rate 4/5, in
 *  milliseconds (Semtech's formula; the same as `lora_airtime_ms` of the server code). */
export function loraAirtimeMs(payloadBytes: number, spreadingFactor: number): number {
  const symbolS = 2 ** spreadingFactor / 125_000
  const lowRate = symbolS > 0.016 ? 1 : 0
  const payloadSymbols = 8 + Math.max(Math.ceil((8 * payloadBytes - 4 * spreadingFactor + 44) / (4 * (spreadingFactor - 2 * lowRate))) * 5, 0)
  return 1000 * (8 + 4.25 + payloadSymbols) * symbolS
}

const FRAME_BYTES = 50

/** The session the page shows for an answer of the database. Null when it holds no report yet. */
export function toSession(answer: StreamAnswer): Session | null {
  if (!answer.buoy || answer.reports.length === 0 || (answer.source !== 'live' && answer.source !== 'simulated')) return null
  return {
    source: answer.source,
    feed: 'hosted',
    scenario: answer.buoy.scenario,
    note: answer.source === 'live' ? '' : 'Simulated data. Not a measurement.',
    interval_s: answer.buoy.interval_s,
    frame_bytes: FRAME_BYTES,
    airtime_ms: Math.round(loraAirtimeMs(FRAME_BYTES, answer.buoy.spreading_factor)),
    spreading_factor: answer.buoy.spreading_factor,
    received_total: answer.link?.received_total ?? answer.reports.length,
    lost_total: answer.link?.lost_total ?? 0,
    now: Math.floor(answer.now_ms / 1000),
    reports: [],
  }
}

/** A row of the database as a report, or null when it is not one the page can read. */
function toReport(item: StreamItem): Report | null {
  try {
    return parseReport(item.report)
  } catch {
    return null
  }
}

/** Seconds between two looks at whether reports still come, and between two tries to find the database. */
const WATCH_MS = 10_000
const RETRY_MS = 30_000

/** Keep the store fed from the database. Until the database answers with a report, the
 *  store goes on showing its built-in sample. Returns a function that ends the following. */
export function follow(store: TelemetryStore, transport: Transport, retryMs = RETRY_MS): () => void {
  let lastId = 0
  let source: string | null = null
  let intervalMs = 10_000
  let lastArrival = 0
  let asking = false
  let stopped = false
  let stopListening = () => {}

  function take(item: StreamItem, arrivedAt: number) {
    if (item.id <= lastId || (item.source !== undefined && item.source !== source)) return
    lastId = item.id
    const report = toReport(item)
    if (!report) return
    lastArrival = arrivedAt
    store.push(report, arrivedAt)
  }

  /** Ask for what came after the last report on the page. Its success or failure is what the page knows of its connection. */
  async function catchUp() {
    if (asking || stopped || source === null) return
    asking = true
    try {
      const answer = await transport.stream(lastId)
      if (stopped) return
      store.setCut(false)
      for (const item of answer.reports) take(item, Date.now() - Math.max(0, answer.now_ms - item.received_ms))
    } catch {
      if (!stopped) store.setCut(true)
    } finally {
      asking = false
    }
  }

  async function begin() {
    if (asking || stopped || source !== null) return
    asking = true
    try {
      const answer = await transport.stream(null)
      const session = toSession(answer)
      const reports = answer.reports.flatMap((item) => toReport(item) ?? [])
      if (stopped || !session || reports.length === 0) return
      const newest = answer.reports[answer.reports.length - 1]!
      source = session.source
      intervalMs = session.interval_s * 1000
      lastId = newest.id
      // How old the newest report is, by the database's own clock, taken off this computer's time.
      lastArrival = Date.now() - Math.max(0, answer.now_ms - newest.received_ms)
      store.adopt(session, reports, lastArrival)
      stopListening = transport.listen(
        (item) => take(item, Date.now()),
        () => void catchUp(),
      )
    } catch {
      // The database cannot be reached, or is not set up yet: the sample goes on, and we try again later.
    } finally {
      asking = false
    }
  }

  void begin()
  const retry = setInterval(() => void begin(), retryMs)
  const watch = setInterval(() => {
    if (source !== null && Date.now() - lastArrival > 3 * intervalMs) void catchUp()
  }, WATCH_MS)
  const onOffline = () => store.setCut(true)
  const onOnline = () => void catchUp()
  if (typeof window !== 'undefined') {
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
  }

  return () => {
    stopped = true
    clearInterval(retry)
    clearInterval(watch)
    stopListening()
    if (typeof window !== 'undefined') {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
    }
  }
}
