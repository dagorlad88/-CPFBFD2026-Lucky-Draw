# #CPFBFD2026 Lucky Draw

Participants, prizes and draw results are stored **on the host** in a single
SQLite file and served by an Express backend (`server.js`). All connected users
share the same data in real time (pushed over Server-Sent Events), so setup on
one machine and the live draw on another stay in sync.

## Prerequisites

- Node.js 18+

## Run locally

Data (`/api/*`) is served by `server.js`; the UI is served by Vite in dev.
Run both with one command:

```bash
npm install
npm run dev:all   # API on :8080 + UI on :3000 together (Ctrl+C stops both)
```

Or run them in two separate terminals:

```bash
npm run server    # Express + SQLite API on http://localhost:8080
npm run dev        # Vite UI on http://localhost:3000 (proxies /api -> 8080)
```

Open http://localhost:3000. Other devices on the same network (phone, iPad)
can open the "Network" URL that Vite prints, e.g. `http://<your-lan-ip>:3000`.

## Run as production (single process)

`server.js` serves the built app **and** the API from one port, so the
frontend's relative `/api` calls resolve to the same origin automatically —
no hardcoded URLs.

```bash
npm start        # builds the app, then serves everything on $PORT (default 8080)
```

## Configuration

| Env var    | Default               | Purpose                            |
| ---------- | --------------------- | ---------------------------------- |
| `PORT`     | `8080`                | Port the server listens on         |
| `DATA_DIR` | `./data`              | Directory holding the SQLite file  |
| `DB_PATH`  | `./data/luckydraw.db` | Full path to the SQLite database   |

## Data model

The SQLite file has two tables that back the Firestore-style store used by the
UI (`src/lib/store.ts`):

- `documents(collection, id, data)` — collections `Eligible_Pool`,
  `Config_Prizes`, `Audit_Log`, `Winner_Registry`
- `files(path, data_url)` — uploaded prize images (base64 data URLs)

## Deploy to a SaaS / cloud host

This is a **Node.js web service** (not a static site): one process serves both
the UI and the API on a single port. Any host that can run a Node web service
works — Render, Railway, Fly.io, Heroku, Azure App Service, a VM, Docker, etc.

### What the platform needs to know

| Setting          | Value                                              |
| ---------------- | -------------------------------------------------- |
| Runtime          | Node.js 18 or newer                                |
| Install command  | `npm ci` (or `npm install`)                        |
| Build command    | `npm run build`                                    |
| Start command    | `node server.js`                                   |
| Listen port      | reads the `PORT` env var (most hosts inject this)  |
| Health check     | `GET /` returns the app                            |

> Do **not** deploy this as a "static site" — that would ship only the UI with
> no backend, and no data would be shared.

### ⚠️ Required: a persistent disk for the SQLite file

All shared data lives in one SQLite file. It **must** sit on storage that
survives restarts and redeploys, otherwise participants/prizes/results are lost
whenever the instance recycles.

1. Attach a **persistent disk / volume** on your host (e.g. Render Disk, Railway
   Volume, Fly Volume, a Docker bind-mount) and mount it at a path such as
   `/data`.
2. Set the env var `DB_PATH=/data/luckydraw.db` so the database is written
   there.

### ⚠️ Run a single instance

The store is a local file, so it is **not** shared across multiple instances.
Keep autoscaling / replica count at **1**. (For multi-instance scale you would
need a networked database instead of SQLite — out of scope here.)

Platforms with ephemeral, per-instance filesystems that scale to many instances
by default (e.g. plain Cloud Run) are a poor fit unless you attach a mounted
volume and pin to a single instance.

### Environment variables to set on the host

| Env var   | Set to                | Notes                                  |
| --------- | --------------------- | -------------------------------------- |
| `PORT`    | *(injected by host)*  | Leave unset if the platform provides it |
| `DB_PATH` | `/data/luckydraw.db`  | Point at the mounted persistent disk    |

### Deploy with Docker

A `Dockerfile` is included. Build and run with a mounted volume for the data:

```bash
docker build -t lucky-draw .
docker run -p 8080:8080 -v lucky-draw-data:/data lucky-draw
```

The image builds the UI and runs `node server.js`; `DB_PATH` defaults to
`/data/luckydraw.db`, and `/data` is a volume so data persists.
