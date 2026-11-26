-- Dhruva Setu: the hosted side, on Supabase (Postgres 15 or newer).
--
-- What this makes
--   public.buoys, public.reports, public.links   what the page reads; anyone may read, nobody may write
--   public.ingest(frame)                         the one door in: 50 bytes as 100 hex characters. A report is
--                                                stored only if its tag was made with a key this database holds
--   public.stream(...)                           what the page asks for: the latest reports, and those it missed
--   private.*                                    keys, the report's layout, the made-up buoy. Not reachable from outside
--   a made-up buoy                               reports every 10 s through the same door, labelled "simulated"
--
-- How to install: paste the whole file into the SQL editor of the project and run it.
-- It checks itself at the end and undoes everything if a check fails. Running it again is harmless.

begin;

create schema if not exists private;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------------------------

create table if not exists public.buoys (
  buoy             smallint primary key check (buoy between 0 and 255),
  name             text not null,
  scenario         text not null default '',
  interval_s       integer not null check (interval_s > 0),
  spreading_factor smallint not null check (spreading_factor between 5 and 12)
);
comment on table public.buoys is 'One row for each buoy: its name and how its radio link is set.';

create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  buoy        smallint not null references public.buoys (buoy),
  seq         integer not null check (seq between 0 and 65535),
  measured_at timestamptz,
  received_at timestamptz not null default now(),
  source      text not null check (source in ('live', 'simulated')),
  frame       bytea not null check (octet_length(frame) = 50),
  report      jsonb not null
);
comment on table public.reports is 'Every report that passed its tag, as it arrived. Rows are added by private.store only.';
comment on column public.reports.source is 'live: tagged with the key of a real buoy. simulated: tagged with the key of the made-up buoy.';
comment on column public.reports.frame is 'The 50 bytes as received. The same bytes are stored once: that is the guard against replays.';
comment on column public.reports.report is 'The decoded report as the page reads it, with what the shore adds: salinity, freezing point, signal.';

create unique index if not exists reports_frame_once on public.reports (frame);
create index if not exists reports_stream on public.reports (buoy, source, id desc);
create index if not exists reports_age on public.reports (source, received_at);

create table if not exists public.links (
  buoy             smallint not null references public.buoys (buoy),
  source           text not null check (source in ('live', 'simulated')),
  received_total   bigint not null default 0,
  lost_total       bigint not null default 0,
  refused_total    bigint not null default 0,
  last_seq         integer,
  last_id          bigint,
  last_received_at timestamptz,
  primary key (buoy, source)
);
comment on table public.links is 'Running totals of each link: reports stored, reports missing by their counter, frames refused.';

create table if not exists private.buoy_keys (
  buoy     smallint not null references public.buoys (buoy),
  source   text not null check (source in ('live', 'simulated')),
  key      bytea not null check (octet_length(key) = 16),
  note     text not null default '',
  added_at timestamptz not null default now(),
  primary key (buoy, source)
);
comment on table private.buoy_keys is 'The AES-128 key of each buoy. The key that verifies a report decides its label, live or simulated.';

create table if not exists private.contract (
  version    integer primary key,
  definition jsonb not null
);
comment on table private.contract is 'contract/report.v1.json of the repository: the one definition of the report.';

create table if not exists private.simulator (
  buoy       smallint primary key references public.buoys (buoy),
  seq        integer not null default 0 check (seq between 0 and 65535),
  enabled    boolean not null default true,
  loss_share real not null default 0.015 check (loss_share >= 0 and loss_share < 1)
);
comment on table private.simulator is 'The made-up buoy: its report counter, and the share of its reports that are lost on air.';

insert into private.contract (version, definition)
values (1, $contract${
  "name": "dhruvasetu.report",
  "version": 1,
  "byte_order": "little",
  "payload_bytes": 42,
  "tag_bytes": 8,
  "tag": "First 8 bytes of AES-128-CMAC (RFC 4493) over the 42 payload bytes. One key per buoy.",
  "size_rule": "42 + 8 = 50 bytes: one Iridium SBD credit (charged per 50 bytes) and within the 51-byte limit of the slowest LoRaWAN data rates.",
  "fields": [
    { "name": "header", "type": "u8", "title": "Format version and message type", "note": "High nibble: version. Low nibble: type, 0 = report." },
    { "name": "buoy", "type": "u8", "title": "Buoy number" },
    { "name": "seq", "type": "u16", "title": "Report counter" },
    { "name": "time", "type": "u32", "unit": "s", "title": "Time of measurement, seconds since 1970-01-01 UTC", "invalid": 0 },
    { "name": "lat", "type": "i32", "scale": 1e-7, "unit": "°", "title": "Latitude, north positive", "invalid": 2147483647 },
    { "name": "lon", "type": "i32", "scale": 1e-7, "unit": "°", "title": "Longitude, east positive", "invalid": 2147483647 },
    { "name": "water_temp_c", "type": "i16", "scale": 0.01, "unit": "°C", "title": "Water temperature", "invalid": -32768 },
    { "name": "conductivity_ms_cm", "type": "u16", "scale": 0.002, "unit": "mS/cm", "title": "Conductivity", "invalid": 65535 },
    { "name": "wave_hs_m", "type": "u16", "scale": 0.001, "unit": "m", "title": "Significant wave height", "invalid": 65535 },
    { "name": "wave_tp_s", "type": "u8", "scale": 0.1, "unit": "s", "title": "Peak wave period", "invalid": 255 },
    { "name": "noise_low_db", "type": "u8", "scale": 0.5, "offset": -40, "unit": "dB", "title": "Noise, 63 to 250 Hz, against the quiet baseline", "invalid": 255 },
    { "name": "noise_mid_db", "type": "u8", "scale": 0.5, "offset": -40, "unit": "dB", "title": "Noise, 250 Hz to 1 kHz, against the quiet baseline", "invalid": 255 },
    { "name": "noise_high_db", "type": "u8", "scale": 0.5, "offset": -40, "unit": "dB", "title": "Noise, 1 to 4 kHz, against the quiet baseline", "invalid": 255 },
    { "name": "air_pressure_hpa", "type": "u16", "scale": 0.1, "unit": "hPa", "title": "Air pressure", "invalid": 65535 },
    { "name": "air_temp_c", "type": "i16", "scale": 0.01, "unit": "°C", "title": "Air temperature", "invalid": -32768 },
    { "name": "humidity_pct", "type": "u8", "scale": 0.5, "unit": "%", "title": "Relative humidity", "invalid": 255 },
    { "name": "hull_temp_c", "type": "i8", "unit": "°C", "title": "Temperature inside the hull", "invalid": -128 },
    { "name": "battery_v", "type": "u16", "scale": 0.001, "unit": "V", "title": "Battery voltage", "invalid": 65535 },
    { "name": "energy_j", "type": "u16", "scale": 0.001, "unit": "J", "title": "Energy used since the last report", "invalid": 65535 },
    { "name": "tilt_deg", "type": "u8", "scale": 0.5, "unit": "°", "title": "Mean tilt from upright", "invalid": 255 },
    { "name": "ice_timer_pct", "type": "u8", "unit": "%", "title": "Share of the freeze-in window for which the ice conditions have held", "invalid": 255 },
    { "name": "flags", "type": "u16", "title": "State (bits 0 and 1) and flags" },
    { "name": "backlog", "type": "u16", "title": "Reports waiting on board" }
  ],
  "states": ["NORMAL", "ICE", "SURVIVAL"],
  "flag_bits": {
    "leak": 2,
    "position_valid": 3,
    "time_valid": 4,
    "bench_timing": 5,
    "conductivity_doubtful": 6,
    "noise_doubtful": 7,
    "low_battery": 8,
    "icing_suspected": 9,
    "recovered": 10,
    "module_present": 11
  }
}$contract$::jsonb)
on conflict (version) do update set definition = excluded.definition;

-- ---------------------------------------------------------------------------------------------
-- 2. The tag: AES-128-CMAC (RFC 4493). The AES itself is pgcrypto's.
-- ---------------------------------------------------------------------------------------------

do $install$
declare
  v_home text;
begin
  select n.nspname into v_home
  from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';
  if v_home is null then
    raise exception 'pgcrypto is not installed';
  end if;
  -- AES-128 in CBC mode with a zero first block and no padding: the chain a CMAC is built on.
  execute format(
    $f$create or replace function private.aes_cbc(p_key bytea, p_message bytea) returns bytea
       language sql immutable strict set search_path = ''
       as $body$ select %1$I.encrypt_iv(p_message, p_key, '\x00000000000000000000000000000000'::bytea, 'aes-cbc/pad:none') $body$$f$,
    v_home);
  execute format(
    $f$create or replace function private.random_key() returns bytea
       language sql volatile set search_path = ''
       as $body$ select %1$I.gen_random_bytes(16) $body$$f$,
    v_home);
end
$install$;

create or replace function private.xor_bytes(p_a bytea, p_b bytea) returns bytea
language plpgsql immutable strict set search_path = '' as $$
declare
  v_result bytea := p_a;
begin
  for v_at in 0 .. octet_length(p_a) - 1 loop
    v_result := set_byte(v_result, v_at, get_byte(p_a, v_at) # get_byte(p_b, v_at));
  end loop;
  return v_result;
end
$$;

-- Multiply a 16-byte block by x in GF(2^128): shift left one bit, and fold the lost bit back in as 0x87.
create or replace function private.gf_double(p_block bytea) returns bytea
language plpgsql immutable strict set search_path = '' as $$
declare
  v_result bytea := p_block;
  v_carry integer := 0;
  v_value integer;
begin
  for v_at in reverse 15 .. 0 loop
    v_value := (get_byte(p_block, v_at) << 1) | v_carry;
    v_carry := v_value >> 8;
    v_result := set_byte(v_result, v_at, v_value & 255);
  end loop;
  if v_carry = 1 then
    v_result := set_byte(v_result, 15, get_byte(v_result, 15) # 135);
  end if;
  return v_result;
end
$$;

create or replace function private.cmac(p_key bytea, p_message bytea) returns bytea
language plpgsql immutable strict set search_path = '' as $$
declare
  c_zero constant bytea := '\x00000000000000000000000000000000';
  v_k1 bytea := private.gf_double(private.aes_cbc(p_key, c_zero));
  v_k2 bytea := private.gf_double(v_k1);
  v_size integer := octet_length(p_message);
  v_whole integer;
  v_last bytea;
begin
  if v_size > 0 and v_size % 16 = 0 then
    v_whole := v_size - 16;
    v_last := private.xor_bytes(substring(p_message from v_whole + 1 for 16), v_k1);
  else
    v_whole := v_size - v_size % 16;
    v_last := private.xor_bytes(
      substring(p_message from v_whole + 1) || '\x80'::bytea || substring(c_zero from 1 for 15 - v_size % 16),
      v_k2);
  end if;
  return substring(private.aes_cbc(p_key, substring(p_message from 1 for v_whole) || v_last) from v_whole + 1 for 16);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. The report: bytes to values and back, by the contract
-- ---------------------------------------------------------------------------------------------

create or replace function private.field_width(p_type text) returns integer
language sql immutable strict set search_path = '' as $$
  select case p_type when 'u8' then 1 when 'i8' then 1 when 'u16' then 2 when 'i16' then 2 when 'u32' then 4 when 'i32' then 4 end
$$;

-- The 42 bytes of measurements as the report the page reads. Null when the bytes are not a report this contract knows.
create or replace function private.unpack(p_frame bytea) returns jsonb
language plpgsql stable strict set search_path = '' as $$
declare
  v_contract jsonb;
  v_field jsonb;
  v_name text;
  v_width integer;
  v_at integer := 0;
  v_raw bigint;
  v_flags integer := 0;
  v_header integer := 0;
  v_report jsonb;
  v_flag record;
begin
  select c.definition into v_contract from private.contract c where c.version = get_byte(p_frame, 0) >> 4;
  if v_contract is null or octet_length(p_frame) < (v_contract ->> 'payload_bytes')::integer then
    return null;
  end if;
  v_report := jsonb_build_object('version', (v_contract ->> 'version')::integer, 'type', 'report');
  for v_field in select jsonb_array_elements(v_contract -> 'fields') loop
    v_name := v_field ->> 'name';
    v_width := private.field_width(v_field ->> 'type');
    v_raw := 0;
    for v_byte in 0 .. v_width - 1 loop
      v_raw := v_raw | (get_byte(p_frame, v_at + v_byte)::bigint << (8 * v_byte));
    end loop;
    if left(v_field ->> 'type', 1) = 'i' and v_raw >= (1::bigint << (8 * v_width - 1)) then
      v_raw := v_raw - (1::bigint << (8 * v_width));
    end if;
    v_at := v_at + v_width;
    if v_name = 'header' then
      v_header := v_raw::integer;
    elsif v_name = 'flags' then
      v_flags := v_raw::integer;
    elsif v_name in ('buoy', 'seq', 'backlog') then
      v_report := v_report || jsonb_build_object(v_name, v_raw);
    elsif v_field ? 'invalid' and v_raw = (v_field ->> 'invalid')::bigint then
      v_report := v_report || jsonb_build_object(v_name, null);
    else
      v_report := v_report || jsonb_build_object(
        v_name,
        v_raw * coalesce((v_field ->> 'scale')::numeric, 1) + coalesce((v_field ->> 'offset')::numeric, 0));
    end if;
  end loop;
  -- Type 0 is a report; no other message exists in version 1.
  if (v_header & 15) <> 0 or (v_flags & 3) >= jsonb_array_length(v_contract -> 'states') then
    return null;
  end if;
  v_report := v_report || jsonb_build_object('state', v_contract -> 'states' ->> (v_flags & 3));
  for v_flag in select key, value::integer as bit from jsonb_each_text(v_contract -> 'flag_bits') loop
    v_report := v_report || jsonb_build_object(v_flag.key, ((v_flags >> v_flag.bit) & 1) = 1);
  end loop;
  return v_report;
end
$$;

-- A report as its 50 bytes: 42 of measurements, then the first 8 bytes of the tag. The made-up buoy speaks through this.
create or replace function private.pack(p_report jsonb, p_key bytea) returns bytea
language plpgsql stable strict set search_path = '' as $$
declare
  v_contract jsonb;
  v_field jsonb;
  v_name text;
  v_kind text;
  v_width integer;
  v_raw bigint;
  v_low bigint;
  v_high bigint;
  v_flags integer;
  v_flag record;
  v_payload bytea := ''::bytea;
begin
  select c.definition into strict v_contract from private.contract c where c.version = 1;
  v_flags := (select ordinality - 1 from jsonb_array_elements_text(v_contract -> 'states') with ordinality as s (state, ordinality)
              where s.state = p_report ->> 'state');
  if v_flags is null then
    raise exception 'unknown state %', p_report ->> 'state';
  end if;
  for v_flag in select key, value::integer as bit from jsonb_each_text(v_contract -> 'flag_bits') loop
    if coalesce((p_report ->> v_flag.key)::boolean, false) then
      v_flags := v_flags | (1 << v_flag.bit);
    end if;
  end loop;
  for v_field in select jsonb_array_elements(v_contract -> 'fields') loop
    v_name := v_field ->> 'name';
    v_kind := v_field ->> 'type';
    v_width := private.field_width(v_kind);
    if left(v_kind, 1) = 'i' then
      v_low := -(1::bigint << (8 * v_width - 1));
      v_high := (1::bigint << (8 * v_width - 1)) - 1;
    else
      v_low := 0;
      v_high := (1::bigint << (8 * v_width)) - 1;
    end if;
    if v_name = 'header' then
      v_raw := (v_contract ->> 'version')::integer << 4;
    elsif v_name = 'flags' then
      v_raw := v_flags;
    elsif v_name = 'seq' then
      v_raw := (p_report ->> 'seq')::bigint & 65535;
    elsif v_name = 'backlog' then
      v_raw := least(coalesce((p_report ->> 'backlog')::bigint, 0), 65535);
    elsif v_name = 'buoy' then
      v_raw := (p_report ->> 'buoy')::bigint;
    elsif p_report -> v_name is null or jsonb_typeof(p_report -> v_name) = 'null' then
      if not v_field ? 'invalid' then
        raise exception '% is required', v_name;
      end if;
      v_raw := (v_field ->> 'invalid')::bigint;
    else
      v_raw := round(((p_report ->> v_name)::numeric - coalesce((v_field ->> 'offset')::numeric, 0))
                     / coalesce((v_field ->> 'scale')::numeric, 1))::bigint;
      if v_raw < v_low or v_raw > v_high or (v_field ? 'invalid' and v_raw = (v_field ->> 'invalid')::bigint) then
        raise exception '% = % does not fit a %', v_name, p_report ->> v_name, v_kind;
      end if;
    end if;
    if v_raw < 0 then
      v_raw := v_raw + (1::bigint << (8 * v_width));
    end if;
    for v_byte in 0 .. v_width - 1 loop
      v_payload := v_payload || set_byte('\x00'::bytea, 0, ((v_raw >> (8 * v_byte)) & 255)::integer);
    end loop;
  end loop;
  return v_payload || substring(private.cmac(p_key, v_payload) from 1 for (v_contract ->> 'tag_bytes')::integer);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Seawater: what the shore works out from a report
-- ---------------------------------------------------------------------------------------------

-- Practical salinity (PSS-78) from conductivity in mS/cm and temperature in degrees Celsius, at the surface.
create or replace function private.salinity(p_conductivity double precision, p_temperature double precision) returns double precision
language plpgsql immutable strict set search_path = '' as $$
declare
  c_a constant double precision[] := array[0.0080, -0.1692, 25.3851, 14.0941, -7.0261, 2.7081];
  c_b constant double precision[] := array[0.0005, -0.0056, -0.0066, -0.0375, 0.0636, -0.0144];
  c_c constant double precision[] := array[0.6766097, 2.00564e-2, 1.104259e-4, -6.9698e-7, 1.0031e-9];
  v_temperature_ratio double precision := 0;
  v_root double precision;
  v_base double precision := 0;
  v_correction double precision := 0;
  v_delta double precision := p_temperature - 15.0;
begin
  for v_power in 0 .. 4 loop
    v_temperature_ratio := v_temperature_ratio + c_c[v_power + 1] * p_temperature ^ v_power;
  end loop;
  v_root := sqrt(greatest(p_conductivity / 42.914 / v_temperature_ratio, 0));
  for v_power in 0 .. 5 loop
    v_base := v_base + c_a[v_power + 1] * v_root ^ v_power;
    v_correction := v_correction + c_b[v_power + 1] * v_root ^ v_power;
  end loop;
  return v_base + v_delta / (1.0 + 0.0162 * v_delta) * v_correction;
end
$$;

-- Conductivity in mS/cm for a salinity and a temperature: PSS-78 turned round, by halving the interval.
create or replace function private.conductivity(p_salinity double precision, p_temperature double precision) returns double precision
language plpgsql immutable strict set search_path = '' as $$
declare
  v_low double precision := 0;
  v_high double precision := 90;
  v_middle double precision;
begin
  for v_step in 1 .. 60 loop
    v_middle := (v_low + v_high) / 2;
    if private.salinity(v_middle, p_temperature) < p_salinity then
      v_low := v_middle;
    else
      v_high := v_middle;
    end if;
  end loop;
  return (v_low + v_high) / 2;
end
$$;

-- Freezing point of seawater at the surface, degrees Celsius (UNESCO 1983).
create or replace function private.freezing_point(p_salinity double precision) returns double precision
language sql immutable strict set search_path = '' as $$
  select -0.0575 * s + 1.710523e-3 * s ^ 1.5 - 2.154996e-4 * s ^ 2 from (select greatest(p_salinity, 0) as s) as salt
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. The door in
-- ---------------------------------------------------------------------------------------------

-- Store one frame if a key of its buoy made its tag. Says what it did; never raises on bad input.
create or replace function private.store(p_frame bytea, p_rssi integer, p_snr real) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  v_buoy integer;
  v_keys integer := 0;
  v_origin text;
  v_key record;
  v_report jsonb;
  v_salinity double precision;
  v_id bigint;
  v_seq integer;
  v_recovered boolean;
begin
  if p_frame is null or octet_length(p_frame) <> 50 then
    return jsonb_build_object('stored', false, 'reason', 'length');
  end if;
  v_buoy := get_byte(p_frame, 1);
  for v_key in select k.key, k.source from private.buoy_keys k where k.buoy = v_buoy order by k.source loop
    v_keys := v_keys + 1;
    if substring(private.cmac(v_key.key, substring(p_frame from 1 for 42)) from 1 for 8) = substring(p_frame from 43 for 8) then
      v_origin := v_key.source;
      exit;
    end if;
  end loop;
  if v_keys = 0 then
    return jsonb_build_object('stored', false, 'reason', 'buoy');
  end if;
  if v_origin is null then
    update public.links set refused_total = refused_total + 1 where buoy = v_buoy;
    return jsonb_build_object('stored', false, 'reason', 'tag');
  end if;

  v_report := private.unpack(p_frame);
  if v_report is null then
    return jsonb_build_object('stored', false, 'reason', 'format');
  end if;
  v_seq := (v_report ->> 'seq')::integer;
  v_recovered := (v_report ->> 'recovered')::boolean;
  if v_report ->> 'conductivity_ms_cm' is not null and v_report ->> 'water_temp_c' is not null then
    v_salinity := private.salinity((v_report ->> 'conductivity_ms_cm')::double precision, (v_report ->> 'water_temp_c')::double precision);
  end if;
  v_report := v_report || jsonb_build_object(
    'buoy_name', (select b.name from public.buoys b where b.buoy = v_buoy),
    'tag_ok', true,
    'salinity', round(v_salinity::numeric, 2),
    'freezing_point_c', round(private.freezing_point(v_salinity)::numeric, 2),
    'rssi_dbm', case when p_rssi between -200 and 50 then p_rssi end,
    'snr_db', case when p_snr between -40 and 40 then round(p_snr::numeric, 1) end,
    'raw', encode(p_frame, 'hex'));

  insert into public.reports (buoy, seq, measured_at, source, frame, report)
  values (v_buoy, v_seq, to_timestamp((v_report ->> 'time')::double precision), v_origin, p_frame, v_report)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('stored', false, 'reason', 'duplicate');
  end if;

  -- A late report from the buoy's own store fills a gap; any other report may open one.
  insert into public.links as l (buoy, source, received_total, lost_total, last_seq, last_id, last_received_at)
  values (v_buoy, v_origin, 1, 0, v_seq, v_id, now())
  on conflict (buoy, source) do update set
    received_total = l.received_total + 1,
    lost_total = case
      when v_recovered then greatest(l.lost_total - 1, 0)
      when (v_seq - l.last_seq + 65536) % 65536 between 2 and 1000 then l.lost_total + (v_seq - l.last_seq + 65536) % 65536 - 1
      else l.lost_total end,
    last_seq = case when v_recovered then l.last_seq else v_seq end,
    last_id = v_id,
    last_received_at = now();

  return jsonb_build_object('stored', true, 'id', v_id, 'source', v_origin, 'seq', v_seq);
end
$$;

-- What a receiver calls: the 50 bytes as 100 hexadecimal characters, and what its radio measured.
create or replace function public.ingest(frame text, rssi_dbm integer default null, snr_db real default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if frame is null or frame !~ '^[0-9A-Fa-f]{100}$' then
    return jsonb_build_object('stored', false, 'reason', 'length');
  end if;
  return private.store(decode(frame, 'hex'), rssi_dbm, snr_db);
end
$$;
comment on function public.ingest(text, integer, real) is
  'Hand in one report: 50 bytes as 100 hex characters. Stored only if its tag is that of a known buoy, and only once.';

-- ---------------------------------------------------------------------------------------------
-- 6. What the page asks
-- ---------------------------------------------------------------------------------------------

-- The latest reports of one buoy, oldest first, or those after a given id; with the time here, so that
-- a page can tell how old a report is without trusting its own clock.
create or replace function public.stream(p_buoy integer default 1, p_source text default null, p_after bigint default null, p_limit integer default 120)
returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_source text := p_source;
  v_limit integer := least(greatest(coalesce(p_limit, 120), 1), 1000);
  v_reports jsonb;
begin
  if v_source is null then
    -- A real buoy heard within the hour comes before the made-up one.
    select l.source into v_source
    from public.links l
    where l.buoy = p_buoy and l.last_received_at is not null
    order by (l.source = 'live' and l.last_received_at > now() - interval '1 hour') desc, l.last_received_at desc
    limit 1;
  end if;
  if p_after is null then
    select coalesce(jsonb_agg(latest.item order by latest.id), '[]'::jsonb) into v_reports
    from (
      select r.id, jsonb_build_object('id', r.id, 'received_ms', floor(extract(epoch from r.received_at) * 1000), 'report', r.report) as item
      from public.reports r
      where r.buoy = p_buoy and r.source = v_source
      order by r.id desc
      limit v_limit
    ) as latest;
  else
    select coalesce(jsonb_agg(missed.item order by missed.id), '[]'::jsonb) into v_reports
    from (
      select r.id, jsonb_build_object('id', r.id, 'received_ms', floor(extract(epoch from r.received_at) * 1000), 'report', r.report) as item
      from public.reports r
      where r.buoy = p_buoy and r.source = v_source and r.id > p_after
      order by r.id
      limit v_limit
    ) as missed;
  end if;
  return jsonb_build_object(
    'now_ms', floor(extract(epoch from clock_timestamp()) * 1000),
    'source', v_source,
    'buoy', (select to_jsonb(b) from public.buoys b where b.buoy = p_buoy),
    'link', (select to_jsonb(l) from public.links l where l.buoy = p_buoy and l.source = v_source),
    'reports', v_reports);
end
$$;
comment on function public.stream(integer, text, bigint, integer) is
  'The latest reports of a buoy, oldest first, or those after an id; with the buoy, the totals of its link and the time here.';

-- ---------------------------------------------------------------------------------------------
-- 7. The made-up buoy
-- ---------------------------------------------------------------------------------------------

create or replace function private.gauss(p_mean double precision, p_deviation double precision) returns double precision
language sql volatile set search_path = '' as $$
  select p_mean + p_deviation * sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random())
$$;

-- One report of the made-up buoy: slow weather off Prydz Bay, a tidal ellipse for its drift, a battery that
-- runs down over thirty days. It is packed and tagged like a real one and comes in through the same door.
create or replace function private.simulate_tick() returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  c_turn constant double precision := 2 * pi();
  v_sim private.simulator%rowtype;
  v_key bytea;
  v_seconds double precision := extract(epoch from clock_timestamp());
  v_hours double precision;
  v_height double precision;
  v_water double precision;
  v_salt double precision;
  v_air double precision;
  v_report jsonb;
begin
  select * into v_sim from private.simulator s where s.enabled order by s.buoy limit 1 for update;
  if not found then
    return null;
  end if;
  select k.key into v_key from private.buoy_keys k where k.buoy = v_sim.buoy and k.source = 'simulated';
  if v_key is null then
    return null;
  end if;
  update private.simulator set seq = (v_sim.seq + 1) % 65536 where buoy = v_sim.buoy;
  if random() < v_sim.loss_share then
    return jsonb_build_object('stored', false, 'reason', 'lost on air');
  end if;

  v_hours := v_seconds / 3600.0;
  v_height := greatest(0.3, 1.6 + 1.0 * sin(c_turn * v_hours / 31.0) + 0.3 * sin(c_turn * v_hours / 7.3 + 1.0) + private.gauss(0, 0.02));
  v_water := -1.20 + 0.04 * sin(c_turn * v_hours / 0.73) + private.gauss(0, 0.008);
  v_salt := 34.10 + 0.02 * sin(c_turn * v_hours / 1.15 + 1.0) + private.gauss(0, 0.004);
  v_air := -8.3 + 3.0 * sin(c_turn * v_hours / 24.0) + private.gauss(0, 0.03);

  v_report := jsonb_build_object(
    'buoy', v_sim.buoy,
    'seq', v_sim.seq,
    'time', floor(v_seconds),
    'lat', -68.6880 + (700.0 * sin(c_turn * v_hours / 12.42) + private.gauss(0, 0.5)) / 111320.0,
    'lon', 76.8700 + (1200.0 * cos(c_turn * v_hours / 12.42) + private.gauss(0, 0.5)) / (111320.0 * cos(radians(-68.688))),
    'water_temp_c', v_water,
    'conductivity_ms_cm', private.conductivity(v_salt, v_water),
    'wave_hs_m', v_height,
    'wave_tp_s', 6.0 + 2.2 * sqrt(v_height) + private.gauss(0, 0.05),
    'noise_low_db', 6.0 + 2.5 * (v_height - 2.3) + private.gauss(0, 0.4),
    'noise_mid_db', private.gauss(2.0, 0.4),
    'noise_high_db', private.gauss(-1.0, 0.4)
  ) || jsonb_build_object(
    'air_pressure_hpa', 990.0 + 12.0 * sin(c_turn * v_hours / 98.4) + 3.0 * sin(c_turn * v_hours / 17.0 + 2.0) + private.gauss(0, 0.03),
    'air_temp_c', v_air,
    'humidity_pct', least(100.0, 78.0 + 6.0 * sin(c_turn * v_hours / 9.0) + private.gauss(0, 0.4)),
    'hull_temp_c', round(v_air + 5.3),
    'battery_v', 4.10 - 0.55 * (v_seconds / 86400.0 - 30 * floor(v_seconds / 86400.0 / 30)) / 30 + private.gauss(0, 0.0004),
    'energy_j', greatest(0.2, private.gauss(0.42, 0.015)),
    'tilt_deg', greatest(0.5, 4.5 + 1.5 * (v_height - 2.3) + private.gauss(0, 0.3)),
    'ice_timer_pct', 0,
    'state', 'NORMAL',
    'position_valid', true,
    'time_valid', true,
    'backlog', 0);

  return private.store(private.pack(v_report, v_key), round(private.gauss(-104, 2.5))::integer, private.gauss(5.5, 1.2)::real);
end
$$;

-- Made-up reports are kept for three days; real ones for ever.
create or replace function private.housekeeping() returns void
language plpgsql volatile set search_path = '' as $$
begin
  delete from public.reports r where r.source = 'simulated' and r.received_at < now() - interval '3 days';
  if to_regclass('cron.job_run_details') is not null then
    execute $sql$delete from cron.job_run_details where end_time < now() - interval '6 hours'$sql$;
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 8. Who may do what
-- ---------------------------------------------------------------------------------------------

alter table public.buoys enable row level security;
alter table public.reports enable row level security;
alter table public.links enable row level security;
alter table private.buoy_keys enable row level security;
alter table private.contract enable row level security;
alter table private.simulator enable row level security;

drop policy if exists "Anyone may read the buoys" on public.buoys;
create policy "Anyone may read the buoys" on public.buoys for select to anon, authenticated using (true);
drop policy if exists "Anyone may read the reports" on public.reports;
create policy "Anyone may read the reports" on public.reports for select to anon, authenticated using (true);
drop policy if exists "Anyone may read the links" on public.links;
create policy "Anyone may read the links" on public.links for select to anon, authenticated using (true);

-- No policy lets anyone write, and the right to write is taken away as well: two locks.
revoke all on public.buoys, public.reports, public.links from anon, authenticated;
grant select on public.buoys, public.reports, public.links to anon, authenticated;

revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

revoke all on function public.ingest(text, integer, real) from public;
revoke all on function public.stream(integer, text, bigint, integer) from public;
grant execute on function public.ingest(text, integer, real) to anon, authenticated;
grant execute on function public.stream(integer, text, bigint, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 9. The buoy, its key, live changes, the clock
-- ---------------------------------------------------------------------------------------------

insert into public.buoys (buoy, name, scenario, interval_s, spreading_factor)
values (1, 'DS-01', 'Prydz Bay, Southern Ocean', 10, 9)
on conflict (buoy) do nothing;

-- The key of the made-up buoy is made here and never leaves: nobody outside can forge even a simulated report.
insert into private.buoy_keys (buoy, source, key, note)
values (1, 'simulated', private.random_key(), 'made by the database for its own made-up buoy')
on conflict (buoy, source) do nothing;

insert into private.simulator (buoy) values (1) on conflict (buoy) do nothing;

do $live$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_catalog.pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reports') then
    alter publication supabase_realtime add table public.reports;
  end if;
end
$live$;

-- The made-up buoy needs a clock. If the clock cannot be set, everything else is still installed
-- and the last lines of this file say so.
do $clock$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('dhruvasetu made-up buoy', '10 seconds', 'select private.simulate_tick()');
    perform cron.schedule('dhruvasetu housekeeping', '17 * * * *', 'select private.housekeeping()');
  else
    raise notice 'pg_cron is not here: the made-up buoy will not report by itself';
  end if;
exception when others then
  raise warning 'the clock of the made-up buoy could not be set: %', sqlerrm;
end
$clock$;

-- What was installed, as a small table: the last thing this file shows.
create or replace function private.install_status() returns table (item text, result text)
language plpgsql stable set search_path = '' as $$
declare
  v_schedule text;
begin
  if to_regclass('cron.job') is not null then
    execute $sql$select schedule from cron.job where jobname = 'dhruvasetu made-up buoy' and active$sql$ into v_schedule;
  end if;
  return query
    select '1. tables and the door'::text, 'installed; the self-check passed'::text
    union all
    select '2. made-up buoy',
           case when v_schedule is null then 'NOT running by itself: the clock (pg_cron) could not be set'
                else 'reports every ' || v_schedule end
    union all
    select '3. live changes to the page',
           case when exists (select 1 from pg_catalog.pg_publication_tables
                             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reports')
                then 'on' else 'NOT on: public.reports is not in the publication supabase_realtime' end
    union all
    select '4. reports stored so far', (select count(*)::text from public.reports)
    union all
    select '5. keys held', (select string_agg(k.source || ' buoy ' || k.buoy, ', ' order by k.buoy, k.source) from private.buoy_keys k);
end
$$;
revoke all on function private.install_status() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 10. The install checks itself. Any failure undoes everything above.
-- ---------------------------------------------------------------------------------------------

do $check$
declare
  c_key constant bytea := '\x2b7e151628aed2a6abf7158809cf4f3c';
  c_message constant bytea := '\x6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710';
  c_frame constant bytea := '\x10010405f0d8076bc83d0fd7b031d22d88ff98356009625c544d9226c2fc9cfd500f2607090018000000937f521d02ea16bc';
  c_sample constant jsonb := '{"buoy": 1, "seq": 1284, "time": 1795676400, "lat": -68.6867, "lon": 76.875, "water_temp_c": -1.2,
    "conductivity_ms_cm": 27.44, "wave_hs_m": 2.4, "wave_tp_s": 9.8, "noise_low_db": 6.0, "noise_mid_db": 2.0, "noise_high_db": -1.5,
    "air_pressure_hpa": 987.4, "air_temp_c": -8.3, "humidity_pct": 78.0, "hull_temp_c": -3, "battery_v": 3.92, "energy_j": 1.83,
    "tilt_deg": 4.5, "ice_timer_pct": 0, "state": "NORMAL", "position_valid": true, "time_valid": true, "backlog": 0}';
  v_back jsonb;
  v_made jsonb;
begin
  -- RFC 4493, the four example tags.
  if encode(private.cmac(c_key, ''::bytea), 'hex') <> 'bb1d6929e95937287fa37d129b756746'
     or encode(private.cmac(c_key, substring(c_message from 1 for 16)), 'hex') <> '070a16b46b4d4144f79bdd9dd04a287c'
     or encode(private.cmac(c_key, substring(c_message from 1 for 40)), 'hex') <> 'dfa66747de9ae63030ca32611497c827'
     or encode(private.cmac(c_key, c_message), 'hex') <> '51f0bebf7e3b9d92fc49741779363cfe' then
    raise exception 'self-check: the tag does not match RFC 4493';
  end if;
  -- The same report, packed here and by the Python of the repository, must be the same 50 bytes.
  if private.pack(c_sample, c_key) <> c_frame then
    raise exception 'self-check: a packed report differs from the reference: %', encode(private.pack(c_sample, c_key), 'hex');
  end if;
  v_back := private.unpack(c_frame);
  if (v_back ->> 'water_temp_c')::numeric <> -1.2 or (v_back ->> 'lat')::numeric <> -68.6867 or (v_back ->> 'seq')::integer <> 1284
     or v_back ->> 'state' <> 'NORMAL' or not (v_back ->> 'position_valid')::boolean or (v_back ->> 'leak')::boolean then
    raise exception 'self-check: an unpacked report differs from the reference: %', v_back;
  end if;
  if abs(private.salinity(42.914, 15.0) - 35.0) > 0.0001 or abs(private.freezing_point(35.0) + 1.922) > 0.001 then
    raise exception 'self-check: the seawater formulas are off';
  end if;
  -- The made-up buoy must be able to speak, and what it says must come back through the door.
  v_made := private.simulate_tick();
  if v_made is null or (not (v_made ->> 'stored')::boolean and v_made ->> 'reason' <> 'lost on air') then
    raise exception 'self-check: the made-up buoy could not report: %', v_made;
  end if;
  if abs(private.salinity(private.conductivity(34.1, -1.2), -1.2) - 34.1) > 0.000001 then
    raise exception 'self-check: conductivity is not the inverse of salinity';
  end if;
  -- A frame with a wrong tag must stay out. The count of refused frames is put back afterwards.
  if (public.ingest(encode(set_byte(c_frame, 49, 0), 'hex')) ->> 'reason') <> 'tag' then
    raise exception 'self-check: a frame with a wrong tag was not refused';
  end if;
  update public.links set refused_total = greatest(refused_total - 1, 0) where buoy = 1;
end
$check$;

commit;

-- Tell the data API that there are new tables and functions, and show what was installed.
notify pgrst, 'reload schema';
select * from private.install_status();
