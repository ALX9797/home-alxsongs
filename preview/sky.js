/* =====================================================================
   sky.js — sun, twilight and moon, computed in the browser.
   ---------------------------------------------------------------------
   No key, no feed, no network. These are the standard low-precision
   astronomy routines: good to about a minute for rise/set times, which
   is far more than a dashboard needs.

   Exposes H.SKY (the maths) and H.sky (the card).
   ===================================================================== */

(function () {
  "use strict";

  var $ = H.$, esc = H.esc, hm = H.hm, dur = H.dur, pad = H.pad;

  /* =====================================================================
     ASTRONOMY
     ===================================================================== */
  var SKY = (function () {
    var rad = Math.PI / 180, dayMs = 86400000, J1970 = 2440588, J2000 = 2451545;
    var e = rad * 23.4397, J0 = 0.0009;

    function toDays(d){ return d.valueOf() / dayMs - 0.5 + J1970 - J2000; }
    function fromJulian(j){ return new Date((j + 0.5 - J1970) * dayMs); }

    function solarMeanAnomaly(d){ return rad * (357.5291 + 0.98560028 * d); }
    function eclipticLongitude(M){
      var C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2*M) + 0.0003 * Math.sin(3*M));
      return M + C + rad * 102.9372 + Math.PI;
    }
    function dec0(l){ return Math.asin(Math.sin(e) * Math.sin(l)); }
    function ra0(l){ return Math.atan2(Math.sin(l) * Math.cos(e), Math.cos(l)); }
    function decB(l,b){ return Math.asin(Math.sin(b)*Math.cos(e) + Math.cos(b)*Math.sin(e)*Math.sin(l)); }
    function raB(l,b){ return Math.atan2(Math.sin(l)*Math.cos(e) - Math.tan(b)*Math.sin(e), Math.cos(l)); }
    function siderealTime(d, lw){ return rad * (280.16 + 360.9856235 * d) - lw; }
    function altitude(Hh, phi, dec){
      return Math.asin(Math.sin(phi)*Math.sin(dec) + Math.cos(phi)*Math.cos(dec)*Math.cos(Hh));
    }

    /* Sun events for a given day. Each named angle produces a rise and a
       set; a polar day or night reports itself instead of returning NaN. */
    function times(date, lat, lng){
      var lw = rad * -lng, phi = rad * lat, d = toDays(date);
      var n = Math.round(d - J0 - lw / (2*Math.PI));
      var ds = J0 + (0 + lw) / (2*Math.PI) + n;
      var M = solarMeanAnomaly(ds), L = eclipticLongitude(M), dec = dec0(L);
      var Jnoon = J2000 + ds + 0.0053*Math.sin(M) - 0.0069*Math.sin(2*L);

      function ev(angle){
        var arg = (Math.sin(angle * rad) - Math.sin(phi)*Math.sin(dec)) / (Math.cos(phi)*Math.cos(dec));
        if (arg <= -1) return { polar: "day" };
        if (arg >=  1) return { polar: "night" };
        var w = Math.acos(arg);
        var a = J0 + (w + lw) / (2*Math.PI) + n;
        var Jset = J2000 + a + 0.0053*Math.sin(M) - 0.0069*Math.sin(2*L);
        return { rise: fromJulian(Jnoon - (Jset - Jnoon)), set: fromJulian(Jset) };
      }

      var sun = ev(-0.833), gold = ev(6), civil = ev(-6), naut = ev(-12);
      return {
        solarNoon: fromJulian(Jnoon),
        sunrise: sun.rise, sunset: sun.set, polar: sun.polar || null,
        goldenEnd: gold.rise || null, goldenStart: gold.set || null,
        dawn: civil.rise || null, dusk: civil.set || null,
        nauticalDawn: naut.rise || null, nauticalDusk: naut.set || null
      };
    }

    function moonCoords(d){
      var L = rad * (218.316 + 13.176396 * d),
          M = rad * (134.963 + 13.064993 * d),
          F = rad * (93.272  + 13.229350 * d),
          l = L + rad * 6.289 * Math.sin(M),
          b = rad * 5.128 * Math.sin(F),
          dt = 385001 - 20905 * Math.cos(M);
      return { ra: raB(l, b), dec: decB(l, b), dist: dt };
    }

    function moon(date){
      var d = toDays(date), sdist = 149598000;
      var sM = solarMeanAnomaly(d), sL = eclipticLongitude(sM);
      var sRa = ra0(sL), sDec = dec0(sL);
      var m = moonCoords(d);
      var phi = Math.acos(Math.sin(sDec)*Math.sin(m.dec) +
                          Math.cos(sDec)*Math.cos(m.dec)*Math.cos(sRa - m.ra));
      var inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
      var angle = Math.atan2(Math.cos(sDec) * Math.sin(sRa - m.ra),
                             Math.sin(sDec) * Math.cos(m.dec) -
                             Math.cos(sDec) * Math.sin(m.dec) * Math.cos(sRa - m.ra));
      return {
        fraction: (1 + Math.cos(inc)) / 2,
        phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI,
        distance: m.dist
      };
    }

    function moonAltitude(date, lat, lng){
      var lw = rad * -lng, phi = rad * lat, d = toDays(date);
      var c = moonCoords(d);
      var Hh = siderealTime(d, lw) - c.ra;
      var h = altitude(Hh, phi, c.dec);
      /* refraction near the horizon */
      return h + rad * 0.017 / Math.tan(h + rad * 10.26 / (h / rad + 5.10));
    }

    /* Hourly scan across the day, fitting a parabola through each triple
       to find where the moon crosses the horizon. */
    function moonTimes(date, lat, lng){
      var t = new Date(date); t.setHours(0,0,0,0);
      var hc = 0.133 * rad;
      var h0 = moonAltitude(t, lat, lng) - hc;
      var rise, set, ye, h1, h2, a, b, xe, d, roots, x1, x2, dx;

      for (var i = 1; i <= 24; i += 2){
        h1 = moonAltitude(new Date(+t + i * 3600000), lat, lng) - hc;
        h2 = moonAltitude(new Date(+t + (i+1) * 3600000), lat, lng) - hc;
        a = (h0 + h2) / 2 - h1;
        b = (h2 - h0) / 2;
        xe = -b / (2*a);
        ye = (a * xe + b) * xe + h1;
        d = b*b - 4*a*h1;
        roots = 0;
        if (d >= 0){
          dx = Math.sqrt(d) / (Math.abs(a) * 2);
          x1 = xe - dx; x2 = xe + dx;
          if (Math.abs(x1) <= 1) roots++;
          if (Math.abs(x2) <= 1) roots++;
          if (x1 < -1) x1 = x2;
        }
        if (roots === 1){ if (h0 < 0) rise = i + x1; else set = i + x1; }
        else if (roots === 2){
          rise = i + (ye < 0 ? x2 : x1);
          set  = i + (ye < 0 ? x1 : x2);
        }
        if (rise != null && set != null) break;
        h0 = h2;
      }

      return {
        rise: rise != null ? new Date(+t + rise * 3600000) : null,
        set:  set  != null ? new Date(+t + set  * 3600000) : null
      };
    }

    function phaseName(p){
      if (p < 0.02 || p > 0.98) return "New moon";
      if (p < 0.24) return "Waxing crescent";
      if (p < 0.26) return "First quarter";
      if (p < 0.49) return "Waxing gibbous";
      if (p < 0.51) return "Full moon";
      if (p < 0.74) return "Waning gibbous";
      if (p < 0.76) return "Last quarter";
      return "Waning crescent";
    }

    return { times: times, moon: moon, moonTimes: moonTimes, phaseName: phaseName };
  })();

  /* =====================================================================
     PIXEL MOON — small image buffer, blown up with image-rendering:pixelated
     ===================================================================== */
  function drawMoon(canvas, phase){
    if (!canvas || !canvas.getContext) return;
    var N = 28, ctx = canvas.getContext("2d");
    canvas.width = N; canvas.height = N;
    var a = phase * 2 * Math.PI, sinA = Math.sin(a), cosA = Math.cos(a);
    var cx = (N-1)/2, cy = (N-1)/2, R = N/2 - 0.5;
    var img = ctx.createImageData(N, N), data = img.data;
    var LIT = [238,242,226,255], DARK = [18,24,34,255], RIM = [92,112,124,255], SEA = [214,220,204,255];

    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++){
      var nx = (x-cx)/R, ny = (y-cy)/R, r2 = nx*nx + ny*ny, i = (y*N+x)*4, c;
      if (r2 > 1){ c = [0,0,0,0]; }
      else {
        var nz = Math.sqrt(1 - r2);
        var lit = (nx * sinA - nz * cosA) > 0;
        /* a couple of deterministic "maria" so the disc isn't flat */
        var mare = ((nx+0.22)*(nx+0.22) + (ny+0.3)*(ny+0.3) < 0.09) ||
                   ((nx-0.3)*(nx-0.3) + (ny-0.12)*(ny-0.12) < 0.05);
        c = r2 > 0.86 ? RIM : (lit ? (mare ? SEA : LIT) : DARK);
      }
      data[i]=c[0]; data[i+1]=c[1]; data[i+2]=c[2]; data[i+3]=c[3];
    }
    ctx.putImageData(img, 0, 0);
  }

  /* =====================================================================
     CARD
     ===================================================================== */
  var lat = null, lon = null, timer = null;

  function arcPoint(f){
    var g = Math.min(Math.max(f, 0), 1);
    return [150 - 140 * Math.cos(Math.PI * g), 80 - 74 * Math.sin(Math.PI * g)];
  }

  function render(){
    if (lat == null) return;
    var box = $("sky");
    if (!box) return;

    var now = new Date();
    var t = SKY.times(now, lat, lon);
    var mo = SKY.moon(now);
    var mt = SKY.moonTimes(now, lat, lon);

    var moonBlock =
      '<div class="moon-wrap">' +
        '<canvas class="moon-c" id="moonC" aria-label="Moon phase"></canvas>' +
        '<div class="moon-name">' + esc(SKY.phaseName(mo.phase)) + '</div>' +
        '<div class="moon-pct">' + Math.round(mo.fraction * 100) + '% lit</div>' +
      '</div>';

    if (t.polar){
      box.innerHTML =
        '<div class="sky-body">' + moonBlock +
        '<div class="sky-right"><div class="state">' +
          (t.polar === "day"
            ? "The sun doesn't set at your latitude right now — endless daylight."
            : "The sun doesn't rise at your latitude right now — polar night.") +
        '</div>' + moonStats(mt) + '</div></div>';
      var m1 = $("skyMeta"); if (m1) m1.textContent = t.polar === "day" ? "midnight sun" : "polar night";
      drawMoon($("moonC"), mo.phase);
      schedule();
      return;
    }

    /* fraction of the way through daylight; outside 0–1 means night */
    var f = (now - t.sunrise) / (t.sunset - t.sunrise);
    var isDay = f >= 0 && f <= 1;
    var p = arcPoint(f);

    /* filled portion of the arc, start → sun */
    var filled = isDay
      ? '<path class="filled" d="M10 80 A 140 74 0 0 1 ' + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + '"/>'
      : "";

    /* golden-hour band, drawn as two shaded wedges under the arc ends */
    function frac(d){ return (d - t.sunrise) / (t.sunset - t.sunrise); }
    var gEnd = t.goldenEnd ? Math.min(Math.max(frac(t.goldenEnd), 0), 1) : 0.06;
    var gStart = t.goldenStart ? Math.min(Math.max(frac(t.goldenStart), 0), 1) : 0.94;

    var svg =
      '<svg viewBox="0 0 300 96" aria-label="Path of the sun today" role="img">' +
        '<defs><linearGradient id="skyg" x1="0" y1="0" x2="1" y2="0">' +
          '<stop offset="0" stop-color="var(--amber)"/>' +
          '<stop offset=".5" stop-color="var(--ice)"/>' +
          '<stop offset="1" stop-color="var(--amber)"/>' +
        '</linearGradient></defs>' +
        '<rect class="band" x="10" y="18" width="' + (280*gEnd).toFixed(1) + '" height="62" fill="var(--amber)"/>' +
        '<rect class="band" x="' + (10 + 280*gStart).toFixed(1) + '" y="18" width="' +
          (280*(1-gStart)).toFixed(1) + '" height="62" fill="var(--amber)"/>' +
        '<path class="track" d="M10 80 A 140 74 0 0 1 290 80"/>' +
        filled +
        '<line class="horizon" x1="2" y1="80" x2="298" y2="80"/>' +
        '<text class="ep" x="6" y="92">' + hm(t.sunrise) + '</text>' +
        '<text class="ep" x="294" y="92" text-anchor="end">' + hm(t.sunset) + '</text>' +
        (isDay
          ? '<circle class="sun" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="5.5"/>'
          : '<circle class="sun night" cx="150" cy="80" r="4"/>') +
      '</svg>';

    /* next event + a phase-of-day label */
    var next, label;
    if (now < t.sunrise){ next = "Sunrise in " + dur(t.sunrise - now); label = "before dawn"; }
    else if (now < t.sunset){ next = "Sunset in " + dur(t.sunset - now); label = "daytime"; }
    else {
      var tmr = SKY.times(new Date(now.getTime() + 86400000), lat, lon);
      next = tmr.sunrise ? "Sunrise in " + dur(tmr.sunrise - now) : "—";
      label = "night";
    }

    var goldenNow =
      (t.goldenEnd && now > t.sunrise && now < t.goldenEnd) ||
      (t.goldenStart && now > t.goldenStart && now < t.sunset);
    if (goldenNow) label = "golden hour";

    /* is today longer or shorter than yesterday? */
    var yst = SKY.times(new Date(now.getTime() - 86400000), lat, lon);
    var deltaTxt = "—";
    if (yst.sunrise && yst.sunset){
      var diff = Math.round(((t.sunset - t.sunrise) - (yst.sunset - yst.sunrise)) / 1000);
      var sign = diff >= 0 ? "+" : "−";
      var ad = Math.abs(diff);
      deltaTxt = sign + Math.floor(ad/60) + "m " + pad(ad % 60) + "s";
    }

    box.innerHTML =
      '<div class="sky-body">' + moonBlock +
        '<div class="sky-right">' +
          '<div class="tag ' + (goldenNow ? "hot" : "ice") + '">' + esc(next) + '</div>' +
          '<div class="sun-arc">' + svg + '</div>' +
          '<div class="kv">' +
            kv("Sunrise", hm(t.sunrise)) +
            kv("Sunset", hm(t.sunset)) +
            kv("Daylight", dur(t.sunset - t.sunrise)) +
            kv("vs yesterday", deltaTxt, diffClass(deltaTxt)) +
            kv("Golden hour", t.goldenStart ? hm(t.goldenStart) : "—", "hot") +
            kv("Solar noon", hm(t.solarNoon)) +
            kv("Moonrise", mt.rise ? hm(mt.rise) : "—", "ice") +
            kv("Moonset", mt.set ? hm(mt.set) : "—", "ice") +
          '</div>' +
        '</div>' +
      '</div>';

    var m2 = $("skyMeta"); if (m2) m2.textContent = label;
    drawMoon($("moonC"), mo.phase);
    schedule();
  }

  function diffClass(txt){ return txt.charAt(0) === "+" ? "hot" : ""; }
  function kv(k, v, cls){
    return '<div><div class="k">' + esc(k) + '</div><div class="v ' + (cls || "") + '">' + esc(v) + '</div></div>';
  }
  function moonStats(mt){
    return '<div class="kv" style="margin-top:14px">' +
      kv("Moonrise", mt.rise ? hm(mt.rise) : "—", "ice") +
      kv("Moonset", mt.set ? hm(mt.set) : "—", "ice") + '</div>';
  }

  function schedule(){
    clearInterval(timer);
    timer = setInterval(render, 60000);
  }

  H.SKY = SKY;
  H.sky = {
    locate: function(la, lo){ lat = la; lon = lo; render(); },
    refresh: render
  };
})();
