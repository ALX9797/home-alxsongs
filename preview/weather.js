/* =====================================================================
   weather.js — Open-Meteo. Free, keyless, and it sends CORS headers, so
   we talk to it directly and only fall back to the Worker if the direct
   call is blocked (corporate proxies, ad blockers, offline).

   Fills both the top-bar summary and the full Weather card.
   ===================================================================== */

(function () {
  "use strict";

  var $ = H.$, esc = H.esc, pad = H.pad, wxFor = H.wxFor;

  var DIRECT = "https://api.open-meteo.com/v1/forecast";
  var PARAMS =
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m," +
      "weather_code,wind_speed_10m,wind_direction_10m,is_day" +
    "&hourly=temperature_2m,weather_code,precipitation_probability" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min," +
      "precipitation_probability_max,uv_index_max" +
    "&timezone=auto&forecast_days=7";

  var lat = null, lon = null, data = null, timer = null;

  function url(){
    return DIRECT + "?latitude=" + lat.toFixed(3) + "&longitude=" + lon.toFixed(3) + PARAMS;
  }
  function proxyUrl(){
    return H.PROXY + "/weather?lat=" + lat.toFixed(3) + "&lon=" + lon.toFixed(3);
  }

  /* ---------------- top bar ---------------- */
  function paintBar(){
    if (!data) return;
    var cur = data.current || {};
    var day = data.daily || {};
    var code = cur.weather_code != null ? cur.weather_code : (day.weather_code || [])[0];
    var wx = wxFor(code);
    var hi = (day.temperature_2m_max || [])[0];
    var lo = (day.temperature_2m_min || [])[0];
    var rain = (day.precipitation_probability_max || [])[0];

    if ($("wxIcon")) $("wxIcon").textContent = wx[1];
    if ($("wxTemp")) $("wxTemp").textContent = cur.temperature_2m != null ? Math.round(cur.temperature_2m) + "°" : "—";
    if ($("wxHiLo")) $("wxHiLo").textContent = (hi != null && lo != null) ? Math.round(hi) + "° / " + Math.round(lo) + "°" : "";
    if ($("wxDesc")) $("wxDesc").textContent = wx[0] + (rain != null && rain >= 20 ? " · " + rain + "% rain" : "");
    if ($("wx")) $("wx").hidden = false;
  }

  /* ---------------- card ---------------- */
  function paintCard(){
    var box = $("weather");
    if (!box) return;
    if (!data){ H.state(box, "Weather unavailable right now.", true); return; }

    var cur = data.current || {};
    var wx = wxFor(cur.weather_code);
    var hourly = data.hourly || {};
    var daily = data.daily || {};

    /* --- now --- */
    var bits = [];
    if (cur.apparent_temperature != null) bits.push("feels " + Math.round(cur.apparent_temperature) + "°");
    if (cur.wind_speed_10m != null) bits.push(Math.round(cur.wind_speed_10m) + " km/h " + H.compass(cur.wind_direction_10m || 0));
    if (cur.relative_humidity_2m != null) bits.push(cur.relative_humidity_2m + "% humidity");
    if ((daily.uv_index_max || [])[0] != null) bits.push("UV " + Math.round(daily.uv_index_max[0]));

    var now =
      '<div class="wx-now">' +
        '<div class="wx-glyph">' + wx[1] + '</div>' +
        '<div class="wx-temp" id="wxBig">' +
          (cur.temperature_2m != null ? Math.round(cur.temperature_2m) + "°" : "—") + '</div>' +
        '<div class="wx-meta">' +
          '<div class="d">' + esc(wx[0]) + '</div>' +
          '<div class="s">' + esc(bits.join(" · ")) + '</div>' +
        '</div>' +
      '</div>';

    /* --- next 12 hours, starting from the current hour --- */
    var strip = "";
    var times = hourly.time || [];
    var start = 0;
    var nowMs = Date.now();
    for (var i = 0; i < times.length; i++){
      if (new Date(times[i]).getTime() >= nowMs - 3600000){ start = i; break; }
    }
    for (var j = start; j < Math.min(start + 12, times.length); j++){
      var d = new Date(times[j]);
      var g = wxFor(hourly.weather_code ? hourly.weather_code[j] : null);
      var pr = hourly.precipitation_probability ? hourly.precipitation_probability[j] : null;
      strip +=
        '<div class="wx-h' + (j === start ? " now" : "") + '">' +
          '<div class="t">' + (j === start ? "now" : pad(d.getHours()) + ":00") + '</div>' +
          '<div class="g">' + g[1] + '</div>' +
          '<div class="c">' + Math.round(hourly.temperature_2m[j]) + '°</div>' +
          '<div class="r">' + (pr != null && pr >= 15 ? pr + "%" : "") + '</div>' +
        '</div>';
    }

    /* --- 7 days, with the range bar scaled to the whole week --- */
    var mins = daily.temperature_2m_min || [], maxs = daily.temperature_2m_max || [];
    var lo = Math.min.apply(null, mins), hi = Math.max.apply(null, maxs);
    var span = Math.max(1, hi - lo);
    var days = "";
    (daily.time || []).forEach(function(t, i){
      var d = new Date(t);
      var g = wxFor((daily.weather_code || [])[i]);
      var l = (mins[i] - lo) / span * 100;
      var w = (maxs[i] - mins[i]) / span * 100;
      days +=
        '<div class="wx-d">' +
          '<div class="dn">' + (i === 0 ? "today" : H.DAYS[d.getDay()].slice(0,3)) + '</div>' +
          '<div class="dg">' + g[1] + '</div>' +
          '<div class="wx-range"><i style="left:' + l.toFixed(1) + '%;width:' + Math.max(w,3).toFixed(1) + '%"></i></div>' +
          '<div class="dt"><s>' + Math.round(mins[i]) + '°</s> ' + Math.round(maxs[i]) + '°</div>' +
        '</div>';
    });

    box.innerHTML = now +
      '<div class="wx-hours">' + strip + '</div>' +
      '<div class="wx-days">' + days + '</div>';

    if ($("wxMeta")) $("wxMeta").textContent = cur.is_day ? "daytime" : "after dark";

    /* roll the big number up rather than snapping it in */
    if (window.FX && cur.temperature_2m != null){
      FX.count($("wxBig"), Math.round(cur.temperature_2m), { suffix:"°", duration:700 });
    }
  }

  /* ---------------- load ---------------- */
  function load(){
    if (lat == null) return;
    H.getJSON(url(), 9000)
      .then(function(j){ data = j; paintBar(); paintCard(); })
      .catch(function(){
        if (!H.PROXY) throw 0;
        return H.getJSON(proxyUrl(), 9000).then(function(j){ data = j; paintBar(); paintCard(); });
      })
      .catch(function(){
        var box = $("weather");
        if (box && !data) H.state(box, "Couldn't reach the weather service.", true);
      });

    clearInterval(timer);
    timer = setInterval(load, 900000);   /* every 15 minutes */
  }

  H.weather = {
    locate: function(la, lo){ lat = la; lon = lo; load(); },
    refresh: load
  };
})();
