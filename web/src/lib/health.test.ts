import { describe, expect, it } from 'vitest'
import { selfTest, withFault } from '../data/simulatedBuoy'
import { parseSession } from '../data/types'
import sessionFile from '../fixtures/session.json'
import { PARTS, assess, snrLimitDb } from './health'
import { notices } from './insight'

const session = parseSession(sessionFile)
const recent = session.reports.slice(-60)
const statusOf = (reports: typeof recent, sinceHeard = 4) =>
  Object.fromEntries(assess(reports, sinceHeard, session).map((item) => [item.part.id, item.status]))
const partOf = (reports: typeof recent, id: string, link = session) => assess(reports, 4, link).find((item) => item.part.id === id)!

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

  it('judges not even the radio when it is the page that lost its database', () => {
    const judged = assess(recent, 45, session, true)
    expect(judged.find((item) => item.part.id === 'radio')).toMatchObject({ status: 'silent' })
    expect(judged.find((item) => item.part.id === 'radio')!.checks[0]!.passed).toBeNull()
    expect(judged.filter((item) => item.status === 'fail' || item.status === 'doubt')).toHaveLength(0)
  })

  it('doubts a value that never changes', () => {
    const frozen = recent.map((report) => ({ ...report, water_temp_c: -1.2 }))
    expect(statusOf(frozen).water_temp).toBe('doubt')
  })

  it('makes no check on a value that was not sent: no value is not a pass', () => {
    const unplugged = recent.map((report) => withFault(report, 'water_temp'))
    expect(partOf(unplugged, 'water_temp').checks.map((check) => check.passed)).toEqual([false, null, null])
    const mute = recent.map((report) => withFault(report, 'motion'))
    expect(partOf(mute, 'motion').checks.map((check) => check.passed)).toEqual([false, null, null])
    expect(partOf(recent, 'water_temp').checks.map((check) => check.passed)).toEqual([true, true, true])
  })

  it('does not call a tag valid that nobody checked', () => {
    const unchecked = partOf(recent.map((report) => ({ ...report, tag_ok: null })), 'computer')
    expect(unchecked.checks[0]!.passed).toBeNull()
    expect(unchecked.status).toBe('ok')
    expect(statusOf(recent.map((report) => ({ ...report, tag_ok: false }))).computer).toBe('fail')
  })

  it('takes the limit of the radio from the spreading factor', () => {
    expect([7, 9, 12].map(snrLimitDb)).toEqual([-7.5, -12.5, -20])
    const weak = recent.map((report) => ({ ...report, snr_db: -10 }))
    expect(partOf(weak, 'radio', { ...session, spreading_factor: 9 }).status).toBe('ok')
    expect(partOf(weak, 'radio', { ...session, spreading_factor: 7 }).status).toBe('doubt')
    expect(partOf(recent, 'radio').checks[1]!.label).toContain('\u221212.5 dB at SF9')
  })

  it('leaves every report as it is when the buoy is only silent', () => {
    expect(recent.map((report) => withFault(report, 'silent'))).toEqual(recent)
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
