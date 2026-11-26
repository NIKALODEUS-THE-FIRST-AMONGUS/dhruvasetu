import { describe, expect, it } from 'vitest'
import { parseSession } from '../data/types'
import sessionFile from '../fixtures/session.json'
import { headline, notices, seaState, trendText } from './insight'

const session = parseSession(sessionFile)
const recent = session.reports.slice(-60)
const latest = recent[recent.length - 1]!

describe('sea state', () => {
  it('follows the WMO table', () => {
    expect(seaState(0.02)).toBe('calm')
    expect(seaState(0.5)).toBe('slight')
    expect(seaState(2.3)).toBe('moderate')
    expect(seaState(2.5)).toBe('rough')
    expect(seaState(15)).toBe('phenomenal')
    expect(seaState(null)).toBeNull()
  })
})

describe('the headline', () => {
  it('says the state, then what deserves attention', () => {
    const found = notices(recent, 4, session.interval_s)
    expect(found.map((notice) => notice.place)).toEqual(['air_pressure_hpa', 'link'])
    const text = headline(latest, found)
    expect(text.startsWith('Working normally in a moderate sea.')).toBe(true)
    expect(text).toContain('Air pressure is falling')
    expect(text).toContain('2 reports were not heard.')
  })

  it('leads with an alarm and drops the reassurance', () => {
    const wet = { ...latest, leak: true }
    const found = notices([...recent.slice(0, -1), wet], 4, session.interval_s)
    expect(found[0]).toMatchObject({ tone: 'alarm', place: 'hull' })
    expect(headline(wet, found)).toBe('Water inside the hull. State NORMAL.')
  })

  it('raises the alarm when the buoy falls silent', () => {
    const found = notices(recent, 45, session.interval_s)
    expect(found[0]).toMatchObject({ tone: 'alarm', place: 'link', text: 'Nothing heard for 45 s.' })
  })

  it('speaks of ice when the water is at its freezing point', () => {
    const cold = { ...latest, water_temp_c: -1.6, freezing_point_c: -1.87 }
    const found = notices([cold], 4, session.interval_s)
    expect(found.map((notice) => notice.text)).toContain('The water is at its freezing point.')
    expect(headline({ ...cold, state: 'ICE' }, [])).toContain('Held in ice.')
  })
})

describe('trend words', () => {
  it('calls small changes steady and names the rest', () => {
    expect(trendText(recent, 'water_temp_c', 1, '°C')).toBe('steady')
    expect(trendText(recent, 'air_pressure_hpa', 1, 'hPa')).toMatch(/^\u2193 falling 1\.\d hPa an hour$/)
  })
})
