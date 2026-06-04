# Shiru — TorBox (debrid) fork

This is a build flavor of Shiru that streams torrents through a
[TorBox](https://torbox.app) debrid account instead of running a local
peer-to-peer WebTorrent engine. It is designed to be installed and run
**side-by-side** with regular Shiru as a backup/alternative.

## How it works

The torrent engine in Shiru lives behind a single IPC seam: the renderer sends
messages (`torrent`, `stage`, `current`, …) to a background worker and consumes
events back (`files`, `activity`, `loaded`, `subtitle`, …). The worker is
resolved through the `webtorrent-client` module alias.

This fork adds a second backend, `client/core/torbox.js`, that implements the
exact same contract but is backed by the TorBox REST API:

- **Add** — `POST /torrents/createtorrent` (magnet or `.torrent` upload).
- **Files** — `GET /torrents/mylist` for metadata + file list.
- **Stream** — `GET /torrents/requestdl` mints a direct, range-capable CDN link
  that the `<video>` element plays from. No local server is needed.
- **Subtitles & fonts** — embedded soft-subs, fonts, tracks and chapters are
  extracted by streaming the container over HTTP range requests
  (`client/lib/httpfile.js` + `matroska-metadata`), so styled ASS subtitles keep
  working. External subtitle/font sidecar files in the torrent are fetched the
  same way.

Concepts that only make sense for local BitTorrent (peer counts, bitfields,
file selection, real seeding) are mapped onto TorBox's cloud model or stubbed
while preserving the event shapes the UI expects. "Seeding" means "retained in
your TorBox cloud".

## Backend selection

The backend is chosen at build time via the `SHIRU_BACKEND` environment
variable, wired through every webpack config:

- unset / `webtorrent` → the standard peer-to-peer build (unchanged).
- `torbox` → this debrid fork.

The renderer learns the flavor through `common/modules/backend.js`
(`process.env.SHIRU_BACKEND` is replaced by webpack's `DefinePlugin`), which is
how the TorBox **API key** field appears in *Settings → Torrent*.

## Building (Electron)

```bash
cd electron

# Dev
npm run start:torbox

# Production installers (installs alongside regular Shiru)
npm run build:torbox
```

`build:torbox` overrides the app identity so the two apps don't collide:

- `appId`  → `com.github.rockinchaos.shiru.torbox`
- `productName` → `Shiru TorBox`

Because the Electron app name differs, the TorBox build gets its **own
`userData` directory** (isolated settings, cache and torrent state) and its own
single-instance lock, so both builds can run at the same time. In dev,
`app.setName('Shiru TorBox')` (in `electron/src/main/main.js`) provides the same
isolation.

## Setup

1. Grab your API token from the TorBox web app (Settings → API key).
2. Open *Settings → Torrent → TorBox API Key* and paste it in.
3. Add torrents exactly as before (search, RSS, magnet, `.torrent`).

## Known limitations / notes

- The `magnet:` and `shiru://` protocol handlers are OS-level and shared; the
  last-installed build wins registration. This does not affect running both
  apps side-by-side.
- Android (Capacitor) builds also select the backend via `SHIRU_BACKEND`, but a
  side-by-side Android install additionally requires a distinct `applicationId`
  in the Capacitor/Gradle config (not yet wired here).
- Uncached torrents must finish downloading to TorBox before playback can start;
  progress is reported through the normal activity UI in the meantime.
- `createtorrent` is rate-limited by TorBox (≈60/hour per token).
