(function () {
  'use strict';
  var disclosure = document.getElementById('olwenDisclosure');
  var expandedKey = 'home.olwen.more.expanded.v2';
  if (disclosure) {
    try {
      var saved = localStorage.getItem(expandedKey);
      if (saved === 'true' || saved === 'false') disclosure.open = saved === 'true';
    } catch (_) {}
    disclosure.addEventListener('toggle', function () {
      try { localStorage.setItem(expandedKey, String(disclosure.open)); } catch (_) {}
    });
  }
  var grid = document.getElementById('olwenNotes');
  var meta = document.getElementById('olwenMeta');
  function node(tag, text, cls) {
    var el = document.createElement(tag);
    el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }
  function date(value) {
    var d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London'
    }).format(d) + ' UK';
  }
  function safeLink(label, url) {
    try {
      var parsed = new URL(url);
      if (!['https:', 'http:'].includes(parsed.protocol)) return null;
      var a = node('a', label + ' ↗');
      a.href = parsed.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
      return a;
    } catch (_) { return null; }
  }
  function renderToday(data) {
    var box = document.getElementById('olwenToday');
    var label = document.getElementById('olwenTodayMeta');
    box.replaceChildren();
    var report = data.today;
    var ukDay = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    if (!report || report.date !== ukDay) {
      label.textContent = report ? 'last researched ' + report.date : 'awaiting morning check';
      box.appendChild(node('p', "Today's match sheet is not available yet. Expand below for the latest saved fixtures and results.", 'olwen-empty'));
      return;
    }
    label.textContent = 'checked ' + date(report.updated_at);
    (Array.isArray(report.coverage) ? report.coverage : []).forEach(function (group) {
      var names = {manutd:'Manchester United',wales:'Wales men',lol:'League of Legends'};
      if (group.status !== 'checked') box.appendChild(node('p', (names[group.group] || group.group) + ': schedule unavailable. Coverage may be incomplete.', 'olwen-empty'));
    });
    var matches = Array.isArray(report.items) ? report.items : [];
    if (!matches.length) box.appendChild(node('p', "No followed matches were returned for today. This reflects the checked providers' coverage.", 'olwen-empty'));
    matches.forEach(function (match) {
      var card = node('article', '', 'olwen-note');
      card.appendChild(node('span', String(match.competition || ''), 'olwen-kicker'));
      card.appendChild(node('h3', String(match.title || 'Match')));
      card.appendChild(node('p', String(match.when || 'Time unconfirmed'), 'olwen-start'));
      card.appendChild(node('p', ({not_started:'Scheduled',running:'Live',finished:'Finished'})[match.status] || String(match.status || '')));
      if (match.detail) card.appendChild(node('p', String(match.detail)));
      var viewing = node('div', '', 'olwen-viewing');
      viewing.appendChild(node('span', 'UK viewing', 'olwen-kicker'));
      var links = Array.isArray(match.viewing) ? match.viewing : [];
      if (!links.length) viewing.appendChild(node('p', 'UK broadcaster not confirmed.'));
      links.forEach(function (source) {
        var a = safeLink(String(source.label || 'Viewing source'), source.url);
        if (a) viewing.appendChild(a);
      });
      if (links.some(function (source) { return source.kind === 'stream'; })) viewing.appendChild(node('p', 'Online stream supplied by the match provider; availability can vary.', 'olwen-date'));
      card.appendChild(viewing);
      var sources = node('div', '', 'olwen-sources');
      (Array.isArray(match.sources) ? match.sources : []).forEach(function (source) {
        var a = safeLink(String(source.title || 'Schedule source'), source.url);
        if (a) sources.appendChild(a);
      });
      card.appendChild(sources);
      card.appendChild(node('p', 'Checked ' + date(match.updated_at), 'olwen-date'));
      box.appendChild(card);
    });
  }
  function render(data) {
    renderToday(data);
    grid.replaceChildren();
    var items = Array.isArray(data.items) ? data.items.filter(function (item) { return item.status === 'provider-data' && Array.isArray(item.facts); }) : [];
    meta.textContent = data.updated_at ? 'updated ' + date(data.updated_at) : 'morning notes';
    if (!items.length) {
      grid.appendChild(node('p', 'A quiet corner for the things I ask Olwen to follow. New notes will appear here in the morning.', 'olwen-empty'));
      return;
    }
    items.forEach(function (item) {
      var card = node('article', '', 'olwen-note');
      card.appendChild(node('span', 'Provider data', 'olwen-kicker'));
      card.appendChild(node('h3', String(item.topic || 'Note')));
      if (!item.facts.length) card.appendChild(node('p', 'No records returned in this provider query. This does not establish that no events are scheduled.'));
      item.facts.forEach(function (fact) {
        var row = node('div', '', 'olwen-fact');
        row.appendChild(node('span', String(fact.competition || ''), 'olwen-kicker'));
        row.appendChild(node('h4', String(fact.title || 'Record')));
        row.appendChild(node('p', String(fact.when || '') + ' · ' + String(fact.status || '')));
        if (fact.detail) row.appendChild(node('p', String(fact.detail), 'olwen-result'));
        card.appendChild(row);
      });
      var stamp = date(item.updated_at);
      var stale = Date.now() - new Date(item.updated_at).getTime() > 36 * 3600000;
      card.appendChild(node('p', (stale ? 'Older note · ' : '') + stamp, 'olwen-date'));
      var links = node('div', '', 'olwen-sources');
      (Array.isArray(item.sources) ? item.sources : []).slice(0, 3).forEach(function (source) {
        try {
          var url = new URL(source.url);
          if (!['https:', 'http:'].includes(url.protocol)) return;
          var a = node('a', String(source.title || url.hostname) + ' ↗');
          a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
          links.appendChild(a);
        } catch (_) {}
      });
      card.appendChild(links); grid.appendChild(card);
    });
  }
  fetch('data/olwen.json', {cache: 'no-store'}).then(function (r) {
    if (!r.ok) throw new Error('unavailable');
    return r.json();
  }).then(render).catch(function () {
    meta.textContent = 'temporarily unavailable';
    document.getElementById('olwenTodayMeta').textContent = 'temporarily unavailable';
    document.getElementById('olwenToday').replaceChildren(node('p', 'The match sheet could not be loaded. Please try again later.', 'olwen-empty'));
    grid.replaceChildren(node('p', 'The morning notes could not be loaded. Please try again later.', 'olwen-empty'));
  });
})();
