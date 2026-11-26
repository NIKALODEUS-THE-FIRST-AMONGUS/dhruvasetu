import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sessionFile from '../fixtures/session.json'
import project from './backend.json'
import { follow, loraAirtimeMs, toSession } from './hosted'
import type { StreamAnswer, StreamItem, Transport } from './hosted'
import { createStore } from './store'
import { parseSession } from './types'

const sample = parseSession(sessionFile)
const BUOY = { buoy: 1, name: 'DS-01', scenario: 'Prydz Bay, Southern Ocean', interval_s: 10, spreading_factor: 9 }
const START = 1_800_000_000_000

/** A database that holds the reports of the sample as rows 1, 2, 3 ... and whose clock runs 7 s ahead of this computer's. */
function fakeDatabase(held: number) {
  const SKEW = 7000
  const state = { held, down: false, asked: [] as (number | null)[], onItem: (_item: StreamItem) => {}, onJoined: () => {} }
  const item = (index: number, receivedMs: number): StreamItem => ({ id: index + 1, received_ms: receivedMs, report: sample.reports[index] })
  const transport: Transport = {
    stream(after) {
      state.asked.push(after)
      if (state.down) return Promise.reject(new Error('Failed to fetch'))
      const now = Date.now() + SKEW
      const ids = [...Array(state.held).keys()].filter((index) => (after === null ? index >= state.held - 60 : index + 1 > after))
      const answer: StreamAnswer = {
        now_ms: now,
        source: state.held > 0 ? 'simulated' : null,
        buoy: BUOY,
        link: state.held > 0 ? { received_total: state.held, lost_total: 2 } : null,
        // The newest report is 4 s old; each one before it 10 s older.
        reports: ids.map((index) => item(index, now - 4000 - (state.held - 1 - index) * 10_000)),
      }
      return Promise.resolve(answer)
    },
    listen(onItem, onJoined) {
      state.onItem = onItem
      state.onJoined = onJoined
      return () => {
        state.onItem = () => {}
      }
    },
  }
  /** A new report is stored and sent to whoever listens. */
  const arrive = () => {
    state.held += 1
    state.onItem({ ...item(state.held - 1, Date.now() + SKEW), source: 'simulated' })
  }
  return { state, transport, arrive }
}

describe('following the database', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('takes up the latest reports and reads their age off the clock of the database', async () => {
    const { transport } = fakeDatabase(80)
    const store = createStore(sample, 60)
    const stop = follow(store, transport)
    await vi.advanceTimersByTimeAsync(0)
    const now = store.getSnapshot()
    expect(now.session).toMatchObject({ feed: 'hosted', source: 'simulated', interval_s: 10, spreading_factor: 9, received_total: 80, lost_total: 2, airtime_ms: 329 })
    expect(now.reports).toHaveLength(60)
    expect(now.latest.seq).toBe(sample.reports[79]!.seq)
    // 4 s old by the database's clock, although that clock is 7 s ahead of ours.
    expect(now.arrivedAt).toBe(START - 4000)
    stop()
  })

  it('adds each new report as it arrives, and ignores one of another source', async () => {
    const { state, transport, arrive } = fakeDatabase(80)
    const store = createStore(sample, 60)
    const stop = follow(store, transport)
    await vi.advanceTimersByTimeAsync(0)
    vi.setSystemTime(START + 6000)
    arrive()
    expect(store.getSnapshot().latest.seq).toBe(sample.reports[80]!.seq)
    expect(store.getSnapshot().arrivedAt).toBe(START + 6000)
    state.onItem({ id: 999, received_ms: 0, source: 'live', report: sample.reports[100] })
    expect(store.getSnapshot().latest.seq).toBe(sample.reports[80]!.seq)
    stop()
  })

  it('asks for what it missed whenever the listening is established again', async () => {
    const { state, transport } = fakeDatabase(80)
    const store = createStore(sample, 60)
    const stop = follow(store, transport)
    await vi.advanceTimersByTimeAsync(0)
    // Three reports are stored while the page is not listening; then the listening comes back.
    state.held = 83
    state.onJoined()
    await vi.advanceTimersByTimeAsync(0)
    expect(state.asked).toEqual([null, 80])
    expect(store.getSnapshot().reports).toHaveLength(63)
    expect(store.getSnapshot().latest.seq).toBe(sample.reports[82]!.seq)
    stop()
  })

  it('tells a lost connection from a silent buoy by asking the database', async () => {
    const { state, transport } = fakeDatabase(80)
    const store = createStore(sample, 60)
    const stop = follow(store, transport)
    await vi.advanceTimersByTimeAsync(0)
    // Nothing arrives. After three intervals the page asks; the database answers "nothing new": the buoy is silent.
    await vi.advanceTimersByTimeAsync(40_000)
    expect(state.asked.length).toBeGreaterThan(1)
    expect(store.getSnapshot().cut).toBe(false)
    // Now the database cannot be reached either: that is a lost connection, and is said so.
    state.down = true
    await vi.advanceTimersByTimeAsync(10_000)
    expect(store.getSnapshot().cut).toBe(true)
    // It comes back, with the reports stored meanwhile.
    state.down = false
    state.held = 85
    await vi.advanceTimersByTimeAsync(10_000)
    expect(store.getSnapshot().cut).toBe(false)
    expect(store.getSnapshot().latest.seq).toBe(sample.reports[84]!.seq)
    stop()
  })

  it('stays on the built-in sample while the database is empty or away, and takes it up when it answers', async () => {
    const { state, transport } = fakeDatabase(0)
    state.down = true
    const store = createStore(sample, 60)
    const stop = follow(store, transport)
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getSnapshot().session.feed).toBeUndefined()
    state.down = false
    await vi.advanceTimersByTimeAsync(30_000)
    expect(store.getSnapshot().session.feed).toBeUndefined()
    state.held = 12
    await vi.advanceTimersByTimeAsync(30_000)
    expect(store.getSnapshot().session.feed).toBe('hosted')
    expect(store.getSnapshot().reports).toHaveLength(12)
    stop()
  })

  it('does nothing more once it is stopped', async () => {
    const { state, transport } = fakeDatabase(80)
    const store = createStore(sample, 60)
    const stop = follow(store, transport)
    await vi.advanceTimersByTimeAsync(0)
    stop()
    const asked = state.asked.length
    await vi.advanceTimersByTimeAsync(120_000)
    expect(state.asked).toHaveLength(asked)
  })
})

describe('the address of the database', () => {
  it('is the one the headers of the hosted page allow, and no secret key is written down', () => {
    const headers = readFileSync(new URL('../../public/_headers', import.meta.url), 'utf8')
    const host = new URL(project.url).host
    expect(headers).toContain(`https://${host}`)
    expect(headers).toContain(`wss://${host}`)
    expect(project.key.startsWith('sb_publishable_')).toBe(true)
  })
})

describe('what the database answers', () => {
  it('is no session while it holds no report', () => {
    expect(toSession({ now_ms: 0, source: null, buoy: BUOY, link: null, reports: [] })).toBeNull()
    expect(toSession({ now_ms: 0, source: 'simulated', buoy: null, link: null, reports: [{ id: 1, received_ms: 0, report: {} }] })).toBeNull()
  })

  it('gives the time on air the server code gives', () => {
    expect(loraAirtimeMs(48, 9)).toBeCloseTo(308, 0)
    expect(loraAirtimeMs(48, 12)).toBeCloseTo(2302, 0)
    expect(Math.round(loraAirtimeMs(50, 9))).toBe(sample.airtime_ms)
  })
})
