/* =====================================================================
   CONFIG — edit this file only.
   ---------------------------------------------------------------------
   Paste your Supabase project URL + anon (public) key below.
   Get them from: Supabase dashboard -> Project Settings -> Data API
                  and -> API Keys -> "anon public"

   Leave them as empty strings and the site still works fine — the Games
   page just falls back to saving scores in this browser only.
   ===================================================================== */

window.CONFIG = {
  SUPABASE_URL: "",   // e.g. "https://abcdefgh.supabase.co"
  SUPABASE_KEY: "",   // the long "anon public" key

  // Table name created by supabase-schema.sql
  GAMES_TABLE: "dutch_blitz_games",

  // Home page personalisation
  OWNER_NAME: "Alex",

  // How far around you to look for aircraft, in nautical miles (max 250)
  FLIGHT_RADIUS_NM: 20,

  // Map tiles: a free CARTO key keeps the pretty dark basemap. Request one at
  // https://carto.com/basemaps/apikey (free, no account — give them this
  // site's domain). Leave empty and the map falls back to Esri's keyless
  // dark canvas instead of CARTO's "API KEY REQUIRED" watermark.
  CARTO_KEY: "cb1_2zx3_1_0b22c6a44b4acdd4085168c8",

  // Your Cloudflare Worker URL (see SETUP.md -> "Flight proxy").
  // The ADS-B feeds don't send CORS headers, so the browser can't read them
  // directly — the Worker sits in front and adds them.
  // e.g. "https://flight-proxy.yourname.workers.dev"
  FLIGHT_PROXY: "https://flight-proxy-worker.alx-5ea.workers.dev/",

  // Fallback location used if you deny/skip the location prompt.
  // (Central London — change to wherever you'd rather default to.)
  FALLBACK_LAT: 51.5072,
  FALLBACK_LON: -0.1276,
  FALLBACK_LABEL: "London (default)"
};
