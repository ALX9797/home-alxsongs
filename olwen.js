(function () {
  'use strict';
  var disclosure = document.getElementById('olwenDisclosure');
  var expandedKey = 'home.olwen.expanded.v1';
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
  function render(data) {
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
    grid.replaceChildren(node('p', 'The morning notes could not be loaded. Please try again later.', 'olwen-empty'));
  });
})();
