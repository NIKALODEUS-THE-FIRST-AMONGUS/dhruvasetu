import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sessionFile from '../fixtures/session.json'
import { createStore } from './store'
import { parseSession } from './types'

const session = parseSession(sessionFile)
const TICK = 2000
const left = session.reports.length - 60

describe('the store of reports', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('lets the reports arrive one by one, and stops when told', () => {
    const store = createStore(session, 60)
    let told = 0
    store.subscribe(() => {
      told += 1
    })
    const stop = store.play(TICK)
    vi.advanceTimersByTime(3 * TICK)
    expect(store.getSnapshot().reports).toHaveLength(63)
    expect(told).toBe(3)
    stop()
    vi.advanceTimersByTime(3 * TICK)
    expect(store.getSnapshot().reports).toHaveLength(63)
  })

  it('starts a sample again after its last report, so that its end is never taken for silence', () => {
    const store = createStore(session, 60)
    store.play(TICK)
    vi.advanceTimersByTime(left * TICK)
    expect(store.getSnapshot()).toMatchObject({ complete: true, run: 0 })
    expect(store.getSnapshot().latest.seq).toBe(session.reports[session.reports.length - 1]!.seq)
    vi.advanceTimersByTime(2 * TICK)
    expect(store.getSnapshot()).toMatchObject({ complete: true, run: 0 })
    vi.advanceTimersByTime(TICK)
    const again = store.getSnapshot()
    expect(again).toMatchObject({ complete: false, run: 1 })
    expect(again.reports).toHaveLength(60)
    vi.advanceTimersByTime(TICK)
    expect(store.getSnapshot().reports).toHaveLength(61)
  })

  it('never starts a live stream again', () => {
    const store = createStore({ ...session, source: 'live' }, 60)
    store.play(TICK)
    vi.advanceTimersByTime((left + 50) * TICK)
    expect(store.getSnapshot()).toMatchObject({ complete: true, run: 0 })
  })

  it('takes up a stream from the database, and the file rests', () => {
    const store = createStore(session, 60)
    store.play(TICK)
    const hosted = session.reports.slice(0, 5)
    store.adopt({ ...session, received_total: 5, lost_total: 0, reports: [] }, hosted, 1000)
    expect(store.getSnapshot()).toMatchObject({ run: 1, cut: false, complete: false, arrivedAt: 1000 })
    expect(store.getSnapshot().session.feed).toBe('hosted')
    expect(store.getSnapshot().reports).toHaveLength(5)
    vi.advanceTimersByTime(20 * TICK)
    expect(store.getSnapshot().reports).toHaveLength(5)
  })

  it('adds the reports that are pushed, counts the missing ones, and takes none twice', () => {
    const store = createStore(session, 60)
    store.adopt({ ...session, received_total: 5, lost_total: 0, reports: [] }, session.reports.slice(0, 5), 1000)
    const sixth = session.reports[5]!
    store.push(sixth, 2000)
    store.push(sixth, 2500)
    expect(store.getSnapshot().reports).toHaveLength(6)
    expect(store.getSnapshot().arrivedAt).toBe(2000)
    // Three counters further on: two reports were missed on the way.
    store.push({ ...sixth, seq: sixth.seq + 3, time: (sixth.time ?? 0) + 30 }, 3000)
    expect(store.getSnapshot().session).toMatchObject({ received_total: 7, lost_total: 2 })
    // One of them comes late, from the buoy's own store.
    store.push({ ...sixth, seq: sixth.seq + 1, time: (sixth.time ?? 0) + 10, recovered: true }, 4000)
    expect(store.getSnapshot().session).toMatchObject({ received_total: 8, lost_total: 1 })
  })

  it('knows a lost connection only for a stream, and forgets it with the next report', () => {
    const store = createStore(session, 60)
    store.setCut(true)
    expect(store.getSnapshot().cut).toBe(false)
    store.adopt({ ...session, reports: [] }, session.reports.slice(0, 5), 1000)
    store.setCut(true)
    expect(store.getSnapshot()).toMatchObject({ cut: true, arrivedAt: 1000 })
    store.push(session.reports[5]!, 2000)
    expect(store.getSnapshot().cut).toBe(false)
  })
})
