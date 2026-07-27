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
  SUPABASE_URL: "https://aysqksqikhsmbouoxved.supabase.co",   // e.g. "https://abcdefgh.supabase.co"
  SUPABASE_KEY: "sb_publishable_SvfAJkozhcEo8Vr3YGFwDQ_IfhurIru",   // the long "anon public" key

  // Table name created by supabase-schema.sql
  GAMES_TABLE: "dutch_blitz_games",

  // Home page personalisation
  OWNER_NAME: "Alex",

  // How far around you to look for aircraft, in nautical miles (max 250)
  FLIGHT_RADIUS_NM: 20,

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
