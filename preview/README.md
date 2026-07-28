# Preview build — "Signal"

A complete overhaul of home.alxsongs.com, built **entirely inside this folder**.
Nothing outside `preview/` has been touched, nothing is committed, and the live
site is untouched until you say so.

## Run it

```bash
powershell -ExecutionPolicy Bypass -File preview/serve.ps1
```

Then open <http://localhost:8000>.

Port 8000 matters: it is already on the Cloudflare Worker's `ALLOWED_ORIGINS`
list, so news, esports and the daily word all work locally exactly as they do
in production. No Node, no Python, no install — `serve.ps1` is a plain
PowerShell static file server. Ctrl+C stops it.

The four pages are `index.html`, `games.html`, `word.html`, `admin.html`.

## What's new

**Design system.** `core.css` is now a single tokenised system — colour, type
scale, space, motion, elevation — instead of a shared file plus four
per-page `<style>` blocks. Every page-specific component now lives in one
place, so there is exactly one file that decides what anything looks like.

**Six palettes, including a light one.** Acid, Ultra, Vapor, Game Boy, Amber
and Paper. Pick from swatches in the dock, cycle with `T`, or search them in
the command palette. Everything re-colours from tokens — including the Leaflet
map, the charts and the word-game tiles.

**Command palette.** `Ctrl/⌘ K` or `/`. Navigate between pages, jump to a card,
switch palette, refresh a feed, start a game, add a note. Each page registers
its own commands with `FX.register()`.

**Motion.** Masked word-by-word hero reveal, scroll-driven progress rail,
blur-and-rise card reveals, pointer spotlight and per-card sheen, marquee
headline ticker, animated counters, tile-flip word reveals, draw-in score
charts, cross-page view transitions. All of it collapses cleanly under
`prefers-reduced-motion`.

**Asymmetric bento.** The old dashboard was ten full-width cards stacked. It is
now a real 12-column grid with cards at 3/4/5/6/7/8/12 columns, each using
container queries so a card adapts to *its own* width rather than the
viewport's.

### New features

| Card | What it does |
|---|---|
| **Weather** | Was a line in the top bar. Now a full card: current conditions, feels-like, wind, humidity, UV, a 12-hour strip and a 7-day range chart. Talks to Open-Meteo directly (it sends CORS headers), falling back to the Worker. |
| **Orbit** | Live ISS position on an equirectangular graticule with the real day/night terminator, half an orbit of ground track ahead, distance from you, and whether it's above your horizon right now. |
| **Launchpad** | Editable shortcut tiles, stored in this browser. |
| **Notes** | The board from your backlog. Add, strike through, delete. Local-first, so it needs no account. |

Existing cards gained: aircraft trails and near/high/fast sorting plus a stats
strip on **Overhead**; moonrise, moonset, golden-hour band, solar noon and
day-length-vs-yesterday on **Sky**; a browsable filmstrip on **On This Day**;
the headline ticker on **Feeds**.

**Dutch Blitz** gained a live score-progression chart, a head-to-head matrix,
an all-time stats rail, win streaks, per-player colours throughout, and `N`/`R`
keyboard shortcuts.

**Not-Wordle** gained staggered tile-flip reveals and a personal record card
(played, solved, win rate, streak, guess distribution) computed from this
browser's history — so it works signed out.

**Admin** gained an overview rail and the new design; the logic is unchanged.

### Nothing was removed

Every existing feature is still here: on this day, sky, overhead map/radar with
routes and photos, feeds, esports, Dutch Blitz ledger with cloud/local storage,
Not-Wordle with the Supabase leaderboard, admin invites/accounts/ledger, magic
links and password auth, per-user preferences, CRT toggle, 8-bit sound,
scroll reveals.

## Structure

The 1,580-line `index.html` is now markup only. Its logic is split into
modules that each own one card:

```
core.css     design system (tokens → palettes → components → cards → pages)
fx.js        palettes, CRT, sound, reveals, command palette, toasts, counters
util.js      shared helpers: fetch-with-timeout, formatting, prefs, storage
sky.js       sun/moon astronomy + the Sky card
weather.js   Open-Meteo + the Weather card and top-bar summary
otd.js       Wikipedia On This Day
flights.js   ADS-B, routes, photos, map, radar, trails
feeds.js     news, esports, headline ticker
orbit.js     ISS
panels.js    Launchpad, Notes, generic modal
home.js      clock, greeting, status rail, geolocation, preferences
games.js     Dutch Blitz
word.js      Not-Wordle
admin.js     admin centre
```

`config.js`, `auth.js`, `db.js` and `words.js` are copies of the live files.
Only `auth.js` changed, and only to add the new cards to the preferences list.

## Promoting it

The folder is self-contained, so going live is a copy:

```bash
cp preview/*.html preview/*.css preview/*.js .
rm serve.ps1 README.md   # if they get copied along
```

Two things to check first:

1. `flight-proxy-worker.js` in the repo root is **out of date** — it only has
   the flights endpoint, while the deployed Worker clearly also serves
   `/news`, `/esports`, `/weather` and `/word`. Worth pulling the real source
   down from Cloudflare before anyone treats that file as the truth.
2. Notes and Launchpad are per-browser. Syncing them needs two small Supabase
   tables; the read/write pair in `panels.js` is the only thing to swap.
