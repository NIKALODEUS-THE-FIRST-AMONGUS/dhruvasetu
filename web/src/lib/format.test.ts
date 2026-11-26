import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../../contract/report.v1.json'
import { parseSession } from '../data/types'
import sessionFile from '../fixtures/session.json'
import { ago, drift, fixed, gaps, latitude, longitude, series, signed, trendPerHour, utcDate, utcTime } from './format'

const session = parseSession(sessionFile)

describe('numbers', () => {
  it('uses a true minus sign and never shows minus zero', () => {
    expect(fixed(-1.18, 1)).toBe('\u22121.2')
    expect(fixed(-0.04, 1)).toBe('0.0')
    expect(fixed(null, 2)).toBe('\u2014')
  })

  it('marks positive differences', () => {
    expect(signed(5.5, 1)).toBe('+5.5')
    expect(signed(-1, 1)).toBe('\u22121.0')
    expect(signed(0.01, 1)).toBe('0.0')
  })
})

describe('positions and times', () => {
  it('writes degrees and decimal minutes', () => {
    expect(latitude(-68.6867)).toBe('68\u00b041.20\u2032\u2009S')
    expect(longitude(76.875)).toBe('076\u00b052.50\u2032\u2009E')
    expect(latitude(12.99999999)).toBe('13\u00b000.00\u2032\u2009N')
  })

  it('writes UTC', () => {
    expect(utcTime(1795676400)).toBe('07:00:00')
    expect(utcDate(1795676400)).toBe('26 Nov 2026')
    expect(ago(4)).toBe('4 s ago')
    expect(ago(600)).toBe('10 min ago')
  })
})

describe('the sample session', () => {
  it('carries every field of the contract', () => {
    const report = session.reports[0]!
    const expected = contract.fields.map((field) => field.name).filter((name) => name !== 'header' && name !== 'flags')
    for (const name of [...expected, ...Object.keys(contract.flag_bits), 'state']) {
      expect(report, name).toHaveProperty(name)
    }
    expect(report.raw).toHaveLength(2 * (contract.payload_bytes + contract.tag_bytes))
    expect(session.reports.every((item) => item.tag_ok === true)).toBe(true)
  })

  it('finds the reports that were not heard', () => {
    expect(gaps(session.reports)).toEqual([[1231, 1232]])
  })

  it('derives trend and drift', () => {
    const trend = trendPerHour(session.reports, 'air_pressure_hpa')
    expect(trend).not.toBeNull()
    expect(trend!).toBeLessThan(-1)
    expect(trend!).toBeGreaterThan(-3)
    const moved = drift(session.reports)!
    expect(moved.distanceM).toBeGreaterThan(100)
    expect(moved.distanceM).toBeLessThan(400)
    expect(series(session.reports, 'water_temp_c', 60)).toHaveLength(60)
  })
})

describe('colours', () => {
  const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8')
  const luminance = (hex: string): number => {
    const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    const [red, green, blue] = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!
  }
  const ratio = (first: string, second: string): number => {
    const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a)
    return (high! + 0.05) / (low! + 0.05)
  }
  const blocks = css.split(':root').slice(1, 3)

  it.each([0, 1])('text colours of theme %i hold 4.5:1 on paper', (index) => {
    const tokens = Object.fromEntries([...blocks[index]!.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/g)].map((match) => [match[1], match[2]]))
    for (const name of ['ink', 'ink-2', 'ink-3', 'sea', 'magenta', 'amber', 'alarm', 'ok', 'ice']) {
      expect(ratio(tokens[name]!, tokens.paper!), name).toBeGreaterThanOrEqual(4.5)
    }
  })
})
