# Dhruva Setu

Telemetry portal of the Dhruva Setu ocean observation buoy. Team Dhruva_1, Smart India Hackathon 2026, PS 26065.

The data on the page is made up until hardware runs. The page says so on every view.

## What is here

| Folder | Content |
|---|---|
| `contract/` | `report.v1.json`: the one definition of the buoy's 50-byte report |
| `server/` | Python, standard library only: report encoder and decoder with its authentication tag, seawater formulas, tests |
| `web/` | The page: React, TypeScript, Vite, Motion |
| `tools/` | `make_fixture.py` writes the sample session the page shows |

## Run the page

Needs Node 22 or newer.

    cd web
    npm install --ignore-scripts
    npm run dev

Open http://localhost:5173. Add `?still` to the address to hold the sample still, and `&theme=dark` for the dark theme.

## Check it

    cd server
    python -m unittest discover -s tests

    cd web
    npm run lint
    npm test
    npm run build
    npm run shots

`npm run shots` photographs the built page with the Chrome on this computer at four screen sizes, lets the sample play,
and fails if the page logs an error or asks any other server for anything. The pictures go to `web/shots/`.

## Status

Built: the report format and the Live view with sample data. Not built yet: the server's live stream and storage,
the Data, System and About views, the shore receiver. The project file of the team holds the plan and every decision.
