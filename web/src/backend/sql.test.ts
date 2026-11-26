// The database side is one SQL file that is pasted into Supabase. These tests run that very
// file in an embedded Postgres (PGlite, with pgcrypto) and check it against the Python of the
// repository: the same 118 frames must decode to the same reports.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { beforeAll, describe, expect, it } from 'vitest'
import contract from '../../../contract/report.v1.json'
import sessionFile from '../fixtures/session.json'

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/20261126160000_reports.sql', import.meta.url), 'utf8')
/** What Supabase has and a bare Postgres has not: its two roles for visitors. */
const LIKE_SUPABASE = 'create role anon nologin; create role authenticated nologin;'
/** The key the sample session was tagged with. It is published on purpose, so it may never be registered in a real database. */
const SAMPLE_KEY = '000102030405060708090a0b0c0d0e0f'
const NUMERIC = ['lat', 'lon', 'water_temp_c', 'conductivity_ms_cm', 'wave_hs_m', 'wave_tp_s', 'noise_low_db', 'noise_mid_db', 'noise_high_db',
  'air_pressure_hpa', 'air_temp_c', 'humidity_pct', 'hull_temp_c', 'battery_v', 'energy_j', 'tilt_deg', 'ice_timer_pct', 'time', 'seq', 'buoy',
  'backlog', 'salinity', 'freezing_point_c', 'rssi_dbm', 'snr_db'] as const
const WORDS = ['state', 'leak', 'position_valid', 'time_valid', 'bench_timing', 'conductivity_doubtful', 'noise_doubtful', 'low_battery',
  'icing_suspected', 'recovered', 'module_present', 'tag_ok', 'buoy_name', 'raw', 'type', 'version'] as const

type Row = Record<string, unknown>
let db: PGlite
const one = async (sql: string, values: unknown[] = []): Promise<Row> => (await db.query<Row>(sql, values)).rows[0]!

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec(LIKE_SUPABASE)
  await db.exec(MIGRATION)
}, 120_000)

describe('the SQL that is pasted into Supabase', () => {
  it('installs, checks itself, and can be run a second time', async () => {
    await db.exec(MIGRATION)
    const made = await one(`select count(*)::int as rows from public.reports where source = 'simulated'`)
    expect(made.rows).toBeLessThanOrEqual(2)
    expect((await one('select count(*)::int as keys from private.buoy_keys')).keys).toBe(1)
    // The file ends by saying what it installed. Here there is no clock and no Supabase publication, and it says so.
    const status = (await db.query<{ item: string; result: string }>('select * from private.install_status()')).rows
    expect(status.map((line) => line.result)).toEqual([
      'installed; the self-check passed',
      'NOT running by itself: the clock (pg_cron) could not be set',
      'NOT on: public.reports is not in the publication supabase_realtime',
      String(made.rows),
      'simulated buoy 1',
    ])
  }, 120_000)

  it('holds the contract of the repository, word for word', async () => {
    expect((await one('select definition from private.contract where version = 1')).definition).toEqual(contract)
  })

  it('decodes the 118 frames of the sample exactly as the Python does', async () => {
    // For this test only, the made-up buoy is given the published sample key.
    await db.exec(`delete from public.reports; delete from public.links;
      update private.buoy_keys set key = decode('${SAMPLE_KEY}', 'hex') where buoy = 1 and source = 'simulated';`)
    for (const report of sessionFile.reports) {
      const answer = (await one('select public.ingest($1, $2, $3) as answer', [report.raw, report.rssi_dbm, report.snr_db])).answer as Row
      expect(answer, `report ${report.seq}`).toMatchObject({ stored: true, source: 'simulated', seq: report.seq })
    }
    const stored = (await db.query<{ report: Row }>('select report from public.reports order by id')).rows.map((row) => row.report)
    expect(stored).toHaveLength(sessionFile.reports.length)
    sessionFile.reports.forEach((expected: Row, index) => {
      const got = stored[index]!
      for (const name of NUMERIC) expect(Number(got[name]), `${name} of report ${String(expected.seq)}`).toBeCloseTo(Number(expected[name]), 9)
      for (const name of WORDS) expect(got[name], `${name} of report ${String(expected.seq)}`).toEqual(expected[name])
    })
  }, 120_000)

  it('counts what was stored and what the counter says is missing', async () => {
    const link = await one(`select received_total::int, lost_total::int, refused_total::int, last_seq from public.links where buoy = 1 and source = 'simulated'`)
    expect(link).toEqual({ received_total: 118, lost_total: 2, refused_total: 0, last_seq: 1284 })
  })

  it('stores the same bytes once, and nothing with a wrong tag or from an unknown buoy', async () => {
    const frame = sessionFile.reports[5]!.raw
    const ingest = async (hex: string) => (await one('select public.ingest($1) as answer', [hex])).answer as Row
    expect(await ingest(frame)).toEqual({ stored: false, reason: 'duplicate' })
    const forged = frame.slice(0, 40) + (frame[40] === '0' ? '1' : '0') + frame.slice(41)
    expect(await ingest(forged)).toEqual({ stored: false, reason: 'tag' })
    expect(await ingest(frame.slice(0, 2) + '09' + frame.slice(4))).toEqual({ stored: false, reason: 'buoy' })
    expect(await ingest(frame.slice(2))).toEqual({ stored: false, reason: 'length' })
    expect(await ingest('zz' + frame.slice(2))).toEqual({ stored: false, reason: 'length' })
    expect((await one('select count(*)::int as rows from public.reports')).rows).toBe(118)
    expect((await one('select refused_total::int from public.links where buoy = 1')).refused_total).toBe(1)
  })

  it('hands the page the latest reports, oldest first, and then only what it missed', async () => {
    const first = (await one('select public.stream(1, null, null, 20) as answer')).answer as { now_ms: number; source: string; buoy: Row; link: Row; reports: { id: number; received_ms: number; report: Row }[] }
    expect(first.source).toBe('simulated')
    expect(first.buoy).toMatchObject({ name: 'DS-01', interval_s: 10, spreading_factor: 9 })
    expect(first.reports).toHaveLength(20)
    expect(first.reports.map((item) => item.report.seq)).toEqual(sessionFile.reports.slice(-20).map((report) => report.seq))
    expect(Math.abs(first.now_ms - Date.now())).toBeLessThan(5000)
    expect(first.reports[19]!.received_ms).toBeLessThanOrEqual(first.now_ms)
    const after = first.reports[14]!.id
    const missed = (await one('select public.stream(1, $1, $2) as answer', ['simulated', after])).answer as typeof first
    expect(missed.reports.map((item) => item.id)).toEqual(first.reports.slice(15).map((item) => item.id))
  })

  it('lets a visitor read and hand in, and nothing else', async () => {
    await db.exec('set role anon')
    try {
      expect((await one('select count(*)::int as rows from public.reports')).rows).toBe(118)
      expect(((await one('select public.ingest($1) as answer', [sessionFile.reports[0]!.raw])).answer as Row).reason).toBe('duplicate')
      await expect(db.query(`insert into public.reports (buoy, seq, source, frame, report) values (1, 1, 'live', decode(repeat('00', 50), 'hex'), '{}')`)).rejects.toThrow(/permission denied/)
      await expect(db.query('update public.reports set seq = 0')).rejects.toThrow(/permission denied/)
      await expect(db.query('delete from public.reports')).rejects.toThrow(/permission denied/)
      await expect(db.query('select key from private.buoy_keys')).rejects.toThrow(/permission denied/)
      await expect(db.query('select private.simulate_tick()')).rejects.toThrow(/permission denied/)
      await expect(db.query(`select private.store(decode(repeat('00', 50), 'hex'), null, null)`)).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec('reset role')
    }
  })

  it('runs a made-up buoy whose reports pass every check the page makes', async () => {
    await db.exec(`delete from public.reports; delete from public.links;
      update private.buoy_keys set key = private.random_key() where buoy = 1 and source = 'simulated';
      update private.simulator set seq = 65500, loss_share = 0.1;`)
    for (let tick = 0; tick < 80; tick += 1) await db.query('select private.simulate_tick()')
    const rows = (await db.query<{ seq: number; report: Row }>('select seq, report from public.reports order by id')).rows
    const link = await one(`select received_total::int, lost_total::int from public.links where buoy = 1 and source = 'simulated'`)
    expect(rows.length).toBeGreaterThan(55)
    expect(rows.length).toBeLessThanOrEqual(80)
    expect(link.received_total).toBe(rows.length)
    // The counter wraps at 65,536 during these ticks; what is missing between the first and the last report is still counted right.
    expect((link.lost_total as number) + rows.length).toBe(((rows[rows.length - 1]!.seq - rows[0]!.seq + 65536) % 65536) + 1)
    for (const { report } of rows) {
      expect(report).toMatchObject({ state: 'NORMAL', tag_ok: true, position_valid: true, time_valid: true, leak: false, buoy_name: 'DS-01' })
      expect(Number(report.water_temp_c)).toBeGreaterThan(-1.4)
      expect(Number(report.water_temp_c)).toBeLessThan(-1.0)
      expect(Number(report.salinity)).toBeGreaterThan(33.9)
      expect(Number(report.salinity)).toBeLessThan(34.3)
      expect(Number(report.water_temp_c) - Number(report.freezing_point_c)).toBeGreaterThan(0.5)
      expect(Number(report.wave_hs_m)).toBeGreaterThanOrEqual(0.3)
      expect(Number(report.wave_hs_m)).toBeLessThan(3.2)
      expect(Number(report.air_pressure_hpa)).toBeGreaterThan(970)
      expect(Number(report.air_pressure_hpa)).toBeLessThan(1010)
      expect(Number(report.battery_v)).toBeGreaterThan(3.5)
      expect(Number(report.tilt_deg)).toBeLessThan(45)
      expect(Math.abs(Number(report.lat) + 68.688)).toBeLessThan(0.01)
      expect(Math.abs(Number(report.time) - Date.now() / 1000)).toBeLessThan(120)
      expect(String(report.raw)).toMatch(/^[0-9a-f]{100}$/)
    }
  }, 120_000)
})
