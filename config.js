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

  // Fallback location used if you deny/skip the location prompt.
  // (Central London — change to wherever you'd rather default to.)
  FALLBACK_LAT: 51.5072,
  FALLBACK_LON: -0.1276,
  FALLBACK_LABEL: "London (default)"
};
