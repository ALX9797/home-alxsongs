/* =====================================================================
   flight-proxy-worker.js  —  Cloudflare Worker
   ---------------------------------------------------------------------
   The ADS-B feeds don't send CORS headers, so a browser refuses to read
   them even though the data is public. This sits in front of them, adds
   the headers, and hands the JSON to your page.

   It is NOT an open proxy: it only ever talks to the two flight APIs
   below, and only answers requests from your own site.

   Deploy: see SETUP.md, section "Flight proxy".
   ===================================================================== */

/* Who is allowed to call this Worker. Add localhost so you can develop. */
const ALLOWED_ORIGINS = [
  "https://home.alxsongs.com",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
];

/* Tried in order. First one that answers wins. */
const UPSTREAMS = [
  (lat, lon, d) => `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${d}`,
  (lat, lon, d) => `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${d}`
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Expose-Headers": "X-Source, X-Cache",
    "Vary": "Origin"
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, "Content-Type": "application/json" }
  });
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const head = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: head });
    }
    if (request.method !== "GET") {
      return json({ error: "GET only" }, 405, head);
    }

    /* ---- validate input, so this can't be pointed anywhere else ---- */
    const q = new URL(request.url).searchParams;
    const lat = parseFloat(q.get("lat"));
    const lon = parseFloat(q.get("lon"));
    if (!isFinite(lat) || !isFinite(lon)) {
      return json({ error: "lat and lon are required" }, 400, head);
    }
    const la = clamp(lat, -90, 90).toFixed(4);
    const lo = clamp(lon, -180, 180).toFixed(4);
    const dist = clamp(parseInt(q.get("dist") || "20", 10) || 20, 1, 250);

    /* ---- 15s edge cache: keeps us well inside upstream rate limits ---- */
    const cache = caches.default;
    const cacheKey = new Request(
      `https://flightcache/?lat=${Number(la).toFixed(2)}&lon=${Number(lo).toFixed(2)}&dist=${dist}`,
      { method: "GET" }
    );

    const cached = await cache.match(cacheKey);
    if (cached) {
      const r = new Response(cached.body, cached);
      for (const [k, v] of Object.entries(head)) r.headers.set(k, v);
      r.headers.set("X-Cache", "HIT");
      return r;
    }

    /* ---- try each upstream ---- */
    const tried = [];
    for (const build of UPSTREAMS) {
      const url = build(la, lo, dist);
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "home.alxsongs.com (personal dashboard)" }
        });
        if (!res.ok) {
          tried.push(`${hostOf(url)}: HTTP ${res.status}`);
          continue;
        }
        const body = await res.text();
        const out = new Response(body, {
          status: 200,
          headers: {
            ...head,
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=15",
            "X-Source": hostOf(url),
            "X-Cache": "MISS"
          }
        });
        ctx.waitUntil(cache.put(cacheKey, out.clone()));
        return out;
      } catch (e) {
        tried.push(`${hostOf(url)}: ${e.message}`);
      }
    }

    return json({ error: "No upstream flight feed reachable", tried }, 502, head);
  }
};
