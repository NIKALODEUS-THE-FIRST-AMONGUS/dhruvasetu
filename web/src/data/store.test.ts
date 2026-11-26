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
})
