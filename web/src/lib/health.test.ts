import { describe, expect, it } from 'vitest'
import { selfTest, withFault } from '../data/simulatedBuoy'
import { parseSession } from '../data/types'
import sessionFile from '../fixtures/session.json'
import { PARTS, assess } from './health'
import { notices } from './insight'

const session = parseSession(sessionFile)
const recent = session.reports.slice(-60)
const statusOf = (reports: typeof recent, sinceHeard = 4) =>
  Object.fromEntries(assess(reports, sinceHeard, session.interval_s).map((item) => [item.part.id, item.status]))

describe('part health from the reports', () => {
  it('finds every fitted part working in the sample', () => {
    const status = statusOf(recent)
    expect(Object.keys(status)).toHaveLength(PARTS.length)
    expect(status.oxygen).toBe('absent')
    expect(Object.entries(status).filter(([id]) => id !== 'oxygen').every(([, value]) => value === 'ok')).toBe(true)
  })

  it('fails the part that stops sending, and only that part', () => {
    const broken = recent.map((report) => withFault(report, 'water_temp'))
    const status = statusOf(broken)
    expect(status.water_temp).toBe('fail')
    expect(status.conductivity).toBe('doubt')
    expect(status.motion).toBe('ok')
    expect(notices(broken, 4, session.interval_s).map((notice) => notice.place)).toContain('water_temp_c')
  })

  it('doubts a conductivity cell that reads like air, and fails on a leak', () => {
    expect(statusOf(recent.map((report) => withFault(report, 'conductivity'))).conductivity).toBe('doubt')
    expect(statusOf(recent.map((report) => withFault(report, 'leak'))).leak).toBe('fail')
    expect(statusOf(recent.map((report) => withFault(report, 'motion'))).motion).toBe('fail')
  })

  it('calls the parts not heard, and the radio failed, when the buoy falls silent', () => {
    const status = statusOf(recent, 45)
    expect(status.radio).toBe('fail')
    expect(status.water_temp).toBe('silent')
    expect(status.oxygen).toBe('absent')
  })

  it('doubts a value that never changes', () => {
    const frozen = recent.map((report) => ({ ...report, water_temp_c: -1.2 }))
    expect(statusOf(frozen).water_temp).toBe('doubt')
  })
})

describe('the simulated self-test', () => {
  const latest = recent[recent.length - 1]!

  it('passes a healthy part and names the fault of a broken one', () => {
    expect(selfTest('water_temp', latest, 'none').passed).toBe(true)
    const open = selfTest('water_temp', latest, 'water_temp')
    expect(open.passed).toBe(false)
    expect(open.detail).toContain('open circuit')
    expect(selfTest('motion', latest, 'motion').detail).toContain('0x68')
  })
})
