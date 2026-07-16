# #CPFBFD2026 Lucky Draw

## Prerequisites

- Node.js 18+

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. Other devices on the same network (phone, iPad)
can open the "Network" URL that Vite prints, e.g. `http://<your-lan-ip>:3000`.

## Build for production

```bash
npm run build    # outputs to dist/
```

## How it works

All data (participants, prizes, draw history, winner registry, uploaded images)
is stored **in-memory** via `src/lib/store.ts` and persisted to the browser's
`localStorage`. The store exposes a Firestore-compatible API so page code
doesn't change.

Because data lives in the browser, the admin setup and the live-draw
presentation must run on the **same browser** (different tabs) to share data.
