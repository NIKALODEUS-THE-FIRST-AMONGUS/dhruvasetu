# Dhruva Setu

Telemetry portal of the Dhruva Setu ocean observation buoy. Team Dhruva_1, Smart India Hackathon 2026, PS 26065.

The data on the page is made up until hardware runs. The page says so on every view.

## What is here

| Folder | Content |
|---|---|
| `contract/` | `report.v1.json`: the one definition of the buoy's 50-byte report |
| `server/` | Python, standard library only: report encoder and decoder with its authentication tag, seawater formulas, tests |
| `web/` | The page: React, TypeScript, Vite, Motion |
| `supabase/` | The database side: one SQL file for a Supabase project. Tables, the door a report comes in by, a made-up buoy |
| `tools/` | `make_fixture.py` writes the sample session built into the page |

## Run the page

Needs Node 22 or newer.

    cd web
    npm install --ignore-scripts
    npm run dev

Open http://localhost:5173. The page follows the project's database when it can reach it, and shows the sample built
into it when it cannot. Add `?sample` to the address to keep it on the sample, `?still` to hold the sample still,
`&theme=dark` for the dark theme, and `&fault=silent` to rehearse a fault from the start (also `water_temp`,
`conductivity`, `motion`, `leak`).

On Windows, double-clicking `start.cmd` does it all: it builds the page, serves it at http://localhost:4173 and opens
the browser. Close its window to stop the page.

## The database

The reports are kept in a Supabase project; nothing runs as a server on a team computer. To set one up, paste
`supabase/migrations/20261126160000_reports.sql` into the project's SQL editor and run it. The file checks itself and
ends with a small table that says what it installed. Then put the project's address and its publishable key into
`web/src/data/backend.ts`.

- A report comes in through `ingest`: 50 bytes as 100 hex characters. It is stored only if its tag was made with a key
  the database holds, and the same bytes are stored once. Anyone may read; nobody may write.
- The key that verifies a report decides its label: `live` for a real buoy, `simulated` for the made-up one, whose key
  is made inside the database and never leaves it.
- Only the publishable key belongs in this repository. A secret key, the database password or a buoy's key never do.

## Check it

    cd server
    python -m unittest discover -s tests

    cd web
    npm run lint
    npm test
    npm run build
    npm run shots

`npm test` also runs the SQL file in an embedded Postgres and holds it against the Python: the same 118 frames must
decode to the same reports.

`npm run shots` photographs the built page with the Chrome on this computer at four screen sizes, lets the sample play,
runs it past its end on a clock turned by hand, and fails if the page logs an error, asks any other server for
anything, or takes the end of the sample for a silent buoy. The pictures go to `web/shots/`.

## Status

Built: the report format, the Live view and the Buoy view (a status dot on every part), the database side and the
page's following of it, all on simulated data. Not built yet: the Data and About views, the buoy's own self-test,
the shore receiver.

## Licence

MIT. See `LICENSE`.
