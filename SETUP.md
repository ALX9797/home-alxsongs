# home.alxsongs.com — setup

Six files, no build step, no dependencies. Works the moment it's on GitHub Pages;
Supabase is only needed so the Dutch Blitz ledger is shared between you and your mates.

```
index.html          the dashboard
games.html          the Dutch Blitz ledger
core.css            shared design system
config.js           ← the only file you need to edit
db.js               storage layer (Supabase, falls back to this browser)
CNAME               tells GitHub Pages the domain
supabase-schema.sql paste into Supabase once
```

---

## 1. Put it on GitHub (10 min)

Keep this separate from `dreamhouse-web` — one repo can only serve one domain.

1. github.com → **New repository** → name it `home-alxsongs` → **Public** → Create.
2. On the new repo page: **uploading an existing file** → drag in all seven files
   from this folder (including `CNAME`) → **Commit changes**.
3. Repo → **Settings** → **Pages** → Source: *Deploy from a branch*, Branch: `main`, folder `/ (root)` → Save.
4. Same page, **Custom domain**: type `home.alxsongs.com` → Save. Tick **Enforce HTTPS**
   once it becomes available (can take up to an hour after DNS resolves).

## 2. DNS (5 min, then wait)

At whoever hosts `alxsongs.com` DNS, add **one** record:

| Type  | Host / Name | Value               |
|-------|-------------|---------------------|
| CNAME | `home`      | `alx9797.github.io` |

That's it — don't touch the existing A records or MX records; the apex domain and
your email keep working exactly as they do now.

Propagation is usually 10–30 minutes. GitHub will show a green tick on the Pages
settings screen when it's happy.

## Not-Wordle (daily word game)

`home.alxsongs.com/word.html` — one shared five-letter word a day, six goes,
with a leaderboard and streaks.

**Setup:** run `supabase-word.sql` in the SQL editor, and redeploy the Worker.
No other configuration.

**How it's built to stay on the right side of the line.** The New York Times has
sent DMCA notices to hundreds of Wordle-alikes, citing the *name* and the
*"look and feel"* — specifically the tile layout and green/yellow/grey colours.
Game mechanics themselves aren't copyrightable, so this is an original game:

- **Our own word list**, derived from SCOWL via the public-domain `word-list`
  package — 956 common answers (about 2.6 years) and 12,578 accepted guesses.
  None of it comes from the NYT.
- **Different colours**: lime for right-place, ice blue for wrong-place. Not
  green and yellow, in the tiles or in the shareable grid.
- **No NYT data or endpoints** are touched.

⚠️ **The name is the weak point.** "Not-Wordle" contains their trademark, which
is exactly the string their automated searches look for, and the name was the
first thing cited in those takedowns. It's your call on a small private site, but
if a notice ever turns up, that's why. Changing it is a two-minute job: the title
and heading in `word.html`, the chip label in `index.html`, and the share text.

**Fairness:** the answer comes from the Worker, which only ever serves *today's*
word and ignores any date you ask it for — so nobody can read ahead from the page
source. Someone determined can still open the network tab; this is a game for
mates, not an exam.

## Admin centre

`home.alxsongs.com/admin` — manage invites, see who has actually signed up,
promote or remove people, and tidy the Dutch Blitz ledger.

**Setup:** run `supabase-admin.sql` in the SQL editor, once, *after* you have
signed in at least one time (it needs your profile row to exist in order to make
you an admin). Then reload the site — an **Admin** chip appears in the top bar.

**How it's protected.** Not by hiding the page: anyone can open `/admin`, and the
publishable key is public by design. The protection is in the database:

- An `is_admin` flag on your profile, which only an existing admin can change.
- Row-level security on the invite list so only admins can read or write it.
- The account listing and deletion are database functions that check `is_admin()`
  before doing anything, and are only granted to signed-in users.

So a non-admin who opens `/admin` sees "no access", and someone calling the API
directly with the public key gets refused just the same. The page is convenience;
the database is the lock.

**Deliberate guard rails:** you can't delete your own account or remove your own
admin rights from this page, and deleting someone requires typing their email to
confirm. Deleting an account removes their preferences but leaves the Dutch Blitz
games they recorded, now unattributed.

## Accounts (optional)

Once Supabase is set up (next section), friends can sign in and keep their own
version of the dashboard: which news topics, which esports, which sections show
at all, and their own flight radius. Signed out, the site still works — settings
just save to that browser instead.

**Sign-in is email + password**, with a magic link kept as a fallback. Passwords
are hashed and stored by Supabase — they never touch this repo, the Worker, or
local storage.

**Turn off email confirmation**, or nobody will be able to sign up without
waiting on an email: Supabase → Authentication → **Sign In / Providers** →
Email → turn **Confirm email** off. That's a safe trade-off here because the
invite list already proves you know the address. Leave it on and new accounts
must confirm by email first, which works but reintroduces the round-trip.

Emails are still used for password resets and magic links. The free tier's shared
sender allows only a handful per hour — if you hit "email rate limit exceeded",
that's what happened. Passwords avoid it for everyday sign-in.

**Sign-up is invite-only**, enforced in the database rather than the page, so it
can't be bypassed. To let someone in, run this in the Supabase SQL editor:

```sql
insert into public.allowed_emails (email, note)
values ('mate@example.com', 'dutch blitz crew');
```

Anyone not on that list gets told the address hasn't been invited, and no account
is created. To revoke, delete the row — then remove the account itself under
**Authentication → Users** if they'd already signed up.

Your own address is added automatically when you run the schema. **Don't skip
that line**, or you'll lock yourself out of your own site.

## Where the games live — a Google Sheet

The Dutch Blitz ledger is a Google Sheet. No project to maintain, no keys,
and nothing that goes to sleep — which is why it moved off Supabase (free
Supabase projects pause after a week of no use, and a paused project cannot
save a game).

1. Make a sheet at [sheets.new](https://sheets.new). Name it whatever you like.
2. In the sheet: **Extensions → Apps Script**. Delete whatever is in the
   editor and paste the whole of `sheet-apps-script.gs` from this folder.
   **Save**.
3. **Deploy → New deployment** → the gear icon → **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
   → **Deploy** → it asks for authorisation (it is your own script) → allow.
4. Copy the **/exec URL** it gives you and paste it into `config.js`:

```js
SHEET_API: "https://script.google.com/macros/s/AKfy.../exec",
```

5. Commit. The ledger pill on the games page flips from *this device only*
   to **sheet sync**.

That URL is the only key to the ledger — keep it to yourselves. Anyone who
has it can add or remove games, which is the same trust level the old
"anyone can record a game" rule had. If a row ever goes wrong, edit it in
the sheet or use **File → Version history** to put it back.

The sheet formats itself on first use: a `Games` tab with a header row.
`players`, `final_scores` and `rounds` are stored as JSON in their cells so
nothing about the games page had to change; the visible columns worth
reading are `played_at`, `winner` and the scores.

**With no `SHEET_API` set**, the site still works — games are kept in the
browser and the pill says *this device only*.

---

## 3. Supabase — accounts, invites and the word game (optional, 15 min)


Without this the games page still works perfectly, it just saves to whichever
browser you're using. With it, everyone sees the same leaderboard.

1. [supabase.com](https://supabase.com) → sign in with GitHub → **New project**.
   - Name: `alxsongs`, pick a region near you (London), set a database password
     (save it somewhere, you won't need it for this).
   - Free tier is plenty. Give it ~2 minutes to spin up.
2. Left sidebar → **SQL Editor** → **New query** → paste the entire contents of
   `supabase-schema.sql` → **Run**. You should see "Success".
3. Left sidebar → **Project Settings** → **Data API** → copy the **Project URL**.
4. **Project Settings** → **API Keys** → copy the **`anon` `public`** key
   (the long one — *not* `service_role`, never put that in a webpage).
5. Edit `config.js` in your repo (pencil icon on GitHub), paste both in:

```js
SUPABASE_URL: "https://xxxxxxxx.supabase.co",
SUPABASE_KEY: "eyJhbGciOi....",
```

6. Commit. Reload games.html — the pill top-right should flip from
   *this device only* to **cloud sync**.

7. Still in Supabase → **Authentication** → **URL Configuration**, set
   **Site URL** to `https://home.alxsongs.com` and add it under **Redirect URLs**
   too, otherwise magic links will bounce people to localhost.

### Is the anon key safe in public code?

Yes — it's designed to be public, and the row-level security policies in the
schema are what actually control access. Worth knowing exactly what those allow:

- **Preferences and profiles** — each person can only read or write their own
  row. Enforced by `auth.uid()` checks in the database, so it holds even if
  someone calls the API directly rather than using the page.
- **Dutch Blitz games** — anyone with the page can read the ledger and record a
  game, so a mate without an account can still enter scores. Deleting now
  requires being signed in, and only works on games you recorded. That's a
  deliberate tightening: the first version of this schema let anyone delete
  anything.
- **The invite list** — not readable from the browser at all. It's only ever
  consulted by a server-side trigger.

The PandaScore token is different: it's a real secret, which is why it lives as a
Cloudflare environment variable and never touches this repo.

---

## Flight proxy (required for the Overhead card)

The ADS-B feeds are public and free, but they don't send CORS headers — so a
browser will fetch the data and then refuse to let the page read it. You can see
this yourself: paste an API URL into a tab and the JSON loads fine, but the same
URL from JavaScript is blocked.

The fix is a tiny Cloudflare Worker that sits in front of them and adds the
headers. Free tier is 100,000 requests a day; this page uses roughly 120 an hour
while open. It is not an open proxy — it only ever talks to the two flight APIs,
only answers requests from your own domain, and validates the coordinates.

1. [dash.cloudflare.com](https://dash.cloudflare.com) → sign up or log in.
   You do **not** need to move your DNS to Cloudflare for this.
2. Left sidebar → **Workers & Pages** → **Create** → **Start with Hello World!**
   → name it `flight-proxy` → **Deploy**.
3. Click **Edit code**. Select everything in the editor and delete it, then paste
   the entire contents of `flight-proxy-worker.js` from this folder.
4. **Deploy**. Cloudflare shows the URL, something like
   `https://flight-proxy.yourname.workers.dev` — copy it.
5. Test it by opening this in a tab (swap in your URL):
   `https://flight-proxy.yourname.workers.dev/?lat=51.56&lon=-3.35&dist=20`
   You should get JSON back.
6. Edit `config.js` in your repo:

```js
FLIGHT_PROXY: "https://flight-proxy.yourname.workers.dev",
```

7. Commit. Reload the dashboard — aircraft should appear, and the small label in
   the Overhead header will read `via api.adsb.lol`.

If you ever change the site's domain, update `ALLOWED_ORIGINS` at the top of
the Worker to match, or it will refuse the requests.

### When the Overhead card says no feed is reachable

Neither adsb.lol nor adsb.fi uses API keys — both are free and keyless. What
they do instead is rate-limit the small pool of IP addresses that every
Cloudflare Worker shares. From your laptop the same URLs answer instantly;
from the Worker they periodically come back `429` (adsb.lol) or `403`
(adsb.fi). That is normal and not something a key can fix on those two feeds.

The Worker is built to ride it out: it caches positions for 60 seconds, keeps
serving the last good answer for up to 30 minutes (the card labels it
`· Xm old` while it does), and only shows an error when there is nothing
fresh *or* cached. Since the fix, the card also prints *which* upstream
refused, e.g. `proxy — HTTP 502 — api.adsb.lol: HTTP 429; opendata.adsb.fi:
HTTP 403`, so you can tell throttling apart from a broken Worker.

If you want a feed that doesn't depend on the shared-IP lottery, add OpenSky
as an authenticated fallback (free tier is plenty for one dashboard):

1. [opensky-network.org](https://opensky-network.org) → sign up → log in →
   your account page → create an **API client**, note the `client_id` and
   `client_secret`. (OAuth2 client-credentials; anonymous calls are bucketed
   by IP and never survive Worker egress, so the secret is required.)
2. Cloudflare dashboard → **Workers & Pages** → your `flight-proxy` worker →
   **Settings** → **Variables and Secrets** → **Add** (as **Secrets**):
   - `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET`.
3. **Deploy** (redeploy the Worker code too, if you haven't since this
   paragraph was added). Reload the dashboard — the Overhead header will read
   `via opensky-network.org` whenever the free feeds are throttling.

Like the PandaScore token, these secrets live only in Cloudflare and never
touch this repo.

### What else the Worker does

It handles three things now, all for the same CORS reason:

| Route      | Feeds                        | Cached |
|------------|------------------------------|--------|
| `/`, `/flights` | adsb.lol, adsb.fi (+ OpenSky fallback when configured, see below) | 60s (30 min stale) |
| `/space`   | ISS position (wheretheiss.at) + M4.5+ earthquakes, last 24h (USGS) | 60s (30 min stale) |
| `/news`    | the RSS feeds in `FEEDS`     | 10 min (2 hr stale) |
| `/weather` | open-meteo.com               | 15 min (3 hr stale) |
| `/esports` | pandascore.co                | 2 min (1 hr stale) |

"Stale" means: if every upstream refuses, it serves the last good answer rather
than an error. That's why the flight card stopped flickering.

**To change your news sources**, edit the `FEEDS` object near the top of the
Worker and redeploy — nothing in the website needs touching. Any feed that stops
responding is skipped rather than breaking its column, and the count in the Feeds
card header (`12 sources · 1 down`) tells you when one has died. Hover it to see
which.

## Esports (LoL + CS2)

Live and upcoming matches come from [PandaScore](https://pandascore.co), which
covers both games under one free key.

**Your API key must never go in this repo — it's public.** It lives as a
Cloudflare environment variable instead, which the Worker reads at runtime. It is
never sent to the browser.

1. [pandascore.co](https://pandascore.co) → sign up free → copy your access token
   from the dashboard. Free tier is 1,000 requests/hour; this page uses about 30.
2. Cloudflare dashboard → **Workers & Pages** → your `flight-proxy` worker →
   **Settings** → **Variables and Secrets** → **Add**.
   - Type: **Secret**
   - Name: `PANDASCORE_TOKEN`
   - Value: your token
   → **Deploy**.
3. Reload the dashboard. The Esports card fills in on its own.

Until you do this the card simply says it needs a key — nothing breaks.

### Notes

- **Which competitions show** is set by the `COMPETITIONS` object near the top of
  the Worker:
  - **LoL** — LEC, LCK, LPL, LCS, Worlds, MSI and First Stand, and nothing else.
    Matched on the exact league name so `LCK` doesn't drag in `LCK Challengers`.
  - **CS2** — the Majors plus the circuit worth watching: IEM, BLAST, ESL Pro
    League, ESL One, PGL, Intel Grand Slam.
  - Anything reading as second-string (challengers, academy, amateur, qualifiers,
    contenders, relegation) is filtered out of both.
  - Edit that object and redeploy to change the list — no website changes needed.
- If none of those are running, it falls back to PandaScore's tier S/A grading so
  the card isn't dead, but it will never pad a real match out with filler.
- Live matches carry a score and link to the official English stream where
  PandaScore provides one.
- Refreshes every 3 minutes while the page is open.
- **HLTV is deliberately not used.** Their `robots.txt` disallows `/matches?*`
  and they block automated access, so scraping their live match data isn't on.
  If you want HLTV *news* headlines, that's a published RSS feed and can be added
  to the `FEEDS` list as a normal news source — just ask.

## Tweaking it

Everything you'd want to change lives in `config.js`:

- `OWNER_NAME` — the name in the big hello
- `FLIGHT_RADIUS_NM` — how far out to look for aircraft (20 nm is a good city default;
  bump it to 40–60 if you're rural)
- `FALLBACK_LAT` / `FALLBACK_LON` / `FALLBACK_LABEL` — used if someone declines the
  location prompt

Colours and type are all CSS variables at the top of `core.css`.

## How the two live data feeds work

**On This Day** — Wikipedia's public `onthisday` feed. Results are filtered so
science and discovery entries surface first, with everything else behind them;
the ↻ button walks through the rest. If Wikipedia is unreachable it falls back to
a small built-in set so the card never looks broken.

**Overhead** — three free, keyless APIs stitched together:

- [adsb.lol](https://adsb.lol) — live ADS-B positions, refreshed every 30 seconds.
  Ground traffic is filtered out, so near an airport you only get what's actually flying.
- [adsbdb.com](https://api.adsbdb.com) — turns a callsign into its route and operator
  (`BAW2LJ` → British Airways, Baltimore → Heathrow). Cached per callsign for the
  session, and only the nearest 12 aircraft get looked up, to stay polite.
- [planespotters.net](https://www.planespotters.net) — a photo of the actual airframe,
  fetched only when you open an aircraft's detail panel.

Flightradar24 doesn't license an embeddable widget for custom sites, which is why
this is built directly against raw ADS-B instead.

Map tiles are CARTO dark when `CARTO_KEY` is set in `config.js`, otherwise
Esri's keyless dark-grey canvas. CARTO's raster tiles print an "API KEY
REQUIRED" watermark on keyless requests (and raster is being retired), so
the page never calls CARTO without a key. The key is free — request one at
https://carto.com/basemaps/apikey with this site's domain, paste it into
`config.js`, upload, hard-refresh. Attribution sits in the map corner in
both cases — leave it in place. Leaflet itself comes from cdnjs.

**Using it:** Map/Radar toggles between the real map and the HUD dial. The radius
slider (5–100 nm) is remembered between visits. Click any aircraft — on the map, the
dial, or in the list — for the full detail panel.

**Godseye extras** (bottom-right console, all keyless, all remembered between visits):

- **Sensor modes** — NVG / thermal / noir / CRT washes over the whole site.
  Keys `1`–`4`, `0` for off.
- **Detect** (`D`) — targeting corners, acid traces and callsigns on the map.
- **▶ Godseye** (`G`) — fullscreen takeover: letterboxed cinema map, live
  telemetry wall (clock, contacts, nearest, ISS, quake), and a command deck:
  filter chips (All / Air / Ground / Orbit / Shakes) plus a target list.
  Pick anything and the globe flies there with a caption. **▶ Tour** loops
  the cinematic flyover for hands-free showing off; picking a target stops
  it. Clicking contacts on the map tracks them too. `G`/`Esc` exits.
- **Follow** (`F`) — locks the map onto the selected aircraft and draws its
  trail. Re-tapping follows a newly selected contact.
- **Share** — copies a link that re-opens the exact radius + selected aircraft.
- **Space layers** — the ISS (🛰, live position/altitude/speed) and the day's
  biggest earthquakes plot on the same map, counts in the Overhead header.
  Served by the Worker's `/space` route; needs a Worker redeploy to appear.

Both need HTTPS to work, so test on the live domain rather than by double-clicking
the file — geolocation in particular is blocked on `file://`.

## Local preview

```bash
cd home-alxsongs
python3 -m http.server 8000
```
Then open http://localhost:8000 — geolocation works on localhost, so you'll get
real flights.
