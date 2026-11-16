// Token Radar dashboard: a static page over window.RADAR, no network, no framework.
//
// Views, by hash: "#/" the board, "#/p/<slug>" one protocol's detail view,
// "#/f?verdict=Farm&category=Dexs" the board with filters applied (shareable, and
// what the filtered screenshot shows). The sandbox recomputes every row's implied
// value live from the stored model inputs, so the model is a living formula here,
// not a hardcoded list of names.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) {
    document.getElementById('board').textContent = 'No radar data: data.js did not load.';
    return;
  }
  var META = D.meta;
  var ROWS = D.rows;
  var state = { q: '', category: '', chain: '', verdict: '', minTvl: 0, sort: 'implied', dir: -1 };
  var sandbox = { scale: 1, growthWeight: META.model.growth_weight, maturityFloor: META.model.maturity_floor };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function usd(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function usdFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(n) { return (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function ageText(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days < 365) return days + 'd';
    return (days / 365).toFixed(1) + 'y';
  }
  function verdictBadge(v) { return '<span class="badge ' + v.toLowerCase() + '">' + v + '</span>'; }
  function growthPctOf(row) {
    return ((row.growth_multiplier - 1) / META.model.growth_weight) * 100;
  }
  function ageFracOf(row) {
    if (row.age_days === null || row.age_days === undefined) return (365 / 1095);
    return Math.min(row.age_days, 1095) / 1095;
  }
  function impliedLive(row) {
    var g = 1 + (growthPctOf(row) / 100) * sandbox.growthWeight;
    var m = sandbox.maturityFloor + ageFracOf(row) * (1 - sandbox.maturityFloor);
    return Math.max(1, Math.round(row.tvl_usd * row.multiple * sandbox.scale * g * m));
  }
  function categories() {
    var seen = {};
    ROWS.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }
  function chains() {
    var seen = {};
    ROWS.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = true; }); });
    return Object.keys(seen).sort();
  }
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var list = ROWS.filter(function (r) {
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0 && (r.category || '').toLowerCase().indexOf(q) < 0)) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.verdict && r.verdict !== state.verdict) return false;
      if (r.tvl_usd < state.minTvl) return false;
      return true;
    });
    var key = state.sort;
    list.sort(function (a, b) {
      var av, bv;
      if (key === 'implied') { av = impliedLive(a); bv = impliedLive(b); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d || 0; bv = b.change_7d || 0; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      if (av < bv) return -1 * state.dir;
      if (av > bv) return 1 * state.dir;
      return a.slug < b.slug ? -1 : 1;
    });
    return list;
  }
  function optionList(values, current, allLabel) {
    var h = '<option value="">' + esc(allLabel) + '</option>';
    values.forEach(function (v) {
      h += '<option value="' + esc(v) + '"' + (v === current ? ' selected' : '') + '>' + esc(v) + '</option>';
    });
    return h;
  }
  function heroHTML() {
    var farm = ROWS.filter(function (r) { return r.verdict === 'Farm'; }).length;
    return '<header class="hero"><h1>Token Radar: pre-token protocols ranked by implied value</h1>' +
      '<p class="lede">Every protocol in the snapshot that records no token yet, ranked by what its launch would be worth if the market priced it like the tokens that already trade.</p>' +
      '<p>Snapshot ' + esc(META.as_of) + ' &middot; ' + esc(META.source) + ' &middot; model ' + esc(META.model_version) + ' (fitted comps model) &middot; watchlist floor ' + usd(META.floor_usd) + '</p>' +
      '<div class="tiles">' +
      '<div class="tile"><b>' + ROWS.length + '</b><span>protocols ranked</span></div>' +
      '<div class="tile"><b>' + META.watchlist_count + '</b><span>watchlist covered</span></div>' +
      '<div class="tile"><b>' + farm + '</b><span>verdict: Farm</span></div>' +
      '<div class="tile"><b>' + META.comp_count + '</b><span>traded comps fitted</span></div>' +
      '<div class="tile"><b>&times;' + META.global_multiple.toFixed(3) + '</b><span>global median mcap / TVL</span></div>' +
      '</div></header>';
  }

  function methodHTML() {
    var m = META.model;
    return '<section class="card"><h2>How the value is worked out</h2>' +
      '<p>Implied value = TVL &times; category multiple &times; growth tilt &times; maturity. ' +
      'The multiple is the median market-cap-to-TVL ratio of the traded protocols in the same category, ' +
      'shrunk toward the global median (' + META.global_multiple.toFixed(3) + ') with weight n / (n + ' + m.shrinkage_k + '), ' +
      'then clamped to [' + m.mult_floor + ', ' + m.mult_cap + ']. Categories with one traded comp or none sit near the ' +
      'global median instead of inheriting one outlier. Growth tilt is 1 + ' + m.growth_weight + ' &times; ' +
      '7-day TVL change (clamped to ' + m.growth_tilt_floor + '%..' + m.growth_tilt_cap + '%). ' +
      'Maturity runs ' + m.maturity_floor + '..1.0 over three years tracked. No protocol name is special-cased.</p>' +
      '<p>Verdict: each farm plan is costed in gas, the yield given up on locked capital, and the farmer&rsquo;s time at $25 an hour. ' +
      'Breakeven share is that cost divided by implied value: Farm below 0.01%, Thin below 0.1%, Skip above. ' +
      'A protocol under $1.25M implied that is also shrinking over 7 days is Skip whatever its breakeven says. ' +
      'A verdict is the plan&rsquo;s net, not a prediction that a token launches.</p>' +
      '<p class="note">What the fit actually says, honestly: TVL explains little of market cap (log-log R&sup2; ' + META.validation.loglog_r2 +
      '), and growth and age explain almost nothing about the multiple (R&sup2; ' + META.validation.ratio_r2 +
      '), so both enter only as small bounded tilts. Out-of-sample median error is about ' +
      Math.round(META.validation.cv_median_ape * 100) + '%, so every row shows the p25&ndash;p75 interval of its ' +
      'multiple and the value under the global median. An implied value is the model&rsquo;s claim, never a promise, ' +
      'and &ldquo;records no token&rdquo; is not proof a protocol has none.</p></section>';
  }
  function sandboxHTML() {
    return '<section class="card sandbox"><h2>Model sandbox: change the model, watch the board move</h2>' +
      '<p class="note">These sliders recompute every row&rsquo;s implied value live from its stored inputs. ' +
      'Farm / Thin / Skip verdicts stay as published under the fitted model.</p>' +
      '<label>Multiple scale &times;<output id="sb-scale">' + sandbox.scale.toFixed(2) + '</output> ' +
      '<input type="range" id="sb-scale-r" min="0.5" max="2" step="0.05" value="' + sandbox.scale + '"></label>' +
      '<label>Growth weight <output id="sb-gw">' + sandbox.growthWeight.toFixed(2) + '</output> ' +
      '<input type="range" id="sb-gw-r" min="0" max="0.5" step="0.05" value="' + sandbox.growthWeight + '"></label>' +
      '<label>Maturity floor <output id="sb-mf">' + sandbox.maturityFloor.toFixed(2) + '</output> ' +
      '<input type="range" id="sb-mf-r" min="0.7" max="1" step="0.05" value="' + sandbox.maturityFloor + '"></label>' +
      '<p><button id="sb-reset" type="button">Reset to the fitted model</button></p></section>';
  }
  function controlsHTML() {
    return '<section class="card"><h2>The board</h2><div class="controls">' +
      '<label>Search<input type="search" id="f-q" placeholder="Name, slug or category" value="' + esc(state.q) + '"></label>' +
      '<label>Category<select id="f-cat">' + optionList(categories(), state.category, 'All categories') + '</select></label>' +
      '<label>Chain<select id="f-chain">' + optionList(chains(), state.chain, 'All chains') + '</select></label>' +
      '<label>Verdict<select id="f-verdict">' + optionList(['Farm', 'Thin', 'Skip'], state.verdict, 'All verdicts') + '</select></label>' +
      '<label>Min TVL<select id="f-tvl">' +
      '<option value="0"' + (state.minTvl === 0 ? ' selected' : '') + '>Any TVL</option>' +
      '<option value="10000000"' + (state.minTvl === 10000000 ? ' selected' : '') + '>&ge; $10M</option>' +
      '<option value="50000000"' + (state.minTvl === 50000000 ? ' selected' : '') + '>&ge; $50M</option>' +
      '<option value="100000000"' + (state.minTvl === 100000000 ? ' selected' : '') + '>&ge; $100M</option>' +
      '<option value="500000000"' + (state.minTvl === 500000000 ? ' selected' : '') + '>&ge; $500M</option></select></label>' +
      '<label>Sort by<select id="f-sort">' +
      '<option value="implied"' + (state.sort === 'implied' ? ' selected' : '') + '>Implied value</option>' +
      '<option value="tvl"' + (state.sort === 'tvl' ? ' selected' : '') + '>TVL</option>' +
      '<option value="growth"' + (state.sort === 'growth' ? ' selected' : '') + '>7-day growth</option>' +
      '<option value="age"' + (state.sort === 'age' ? ' selected' : '') + '>Age</option>' +
      '<option value="name"' + (state.sort === 'name' ? ' selected' : '') + '>Name</option></select></label>' +
      '</div><p class="count" id="row-count"></p><div id="table-wrap"></div></section>';
  }
  function tableHTML(list) {
    if (list.length === 0) return '<p>No protocols match these filters.</p>';
    var h = '<table class="board"><thead><tr><th>#</th><th>Protocol</th><th>Category</th>' +
      '<th class="num">TVL</th><th class="num">7d</th><th class="num">Age</th>' +
      '<th class="num">Implied value</th><th class="num">Multiple</th><th>Verdict</th></tr></thead><tbody>';
    list.forEach(function (r) {
      h += '<tr data-slug="' + esc(r.slug) + '"><td>' + r.rank + '</td>' +
        '<td><a href="#/p/' + esc(r.slug) + '">' + esc(r.name) + '</a>' +
        (r.on_watchlist ? ' <span class="badge watch">watchlist</span>' : '') +
        '<br><span class="pill">' + esc(r.chains.slice(0, 3).join(' · ')) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num">' + (r.change_7d === null ? '—' : pct(r.change_7d)) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num"><b>' + usd(impliedLive(r)) + '</b></td>' +
        '<td class="num">&times;' + r.multiple.toFixed(3) + '</td>' +
        '<td>' + verdictBadge(r.verdict) + '</td></tr>';
    });
    return h + '</tbody></table>';
  }
  function liveHTML() {
    var h = '<section class="card"><h2>Already trading: the live set (not ranked)</h2>' +
      '<p>These protocols already have a token, so the board shows the market&rsquo;s own value, never a model&rsquo;s. ' +
      'They are here so a reader can see what the comps look like &mdash; and so the radar never mixes a live token into the pre-token ranking.</p>' +
      '<table class="board"><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">mcap / TVL</th></tr></thead><tbody>';
    D.live.forEach(function (r) {
      h += '<tr><td>' + esc(r.name) + (r.symbol ? ' <span class="pill">' + esc(r.symbol) + '</span>' : '') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td><td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num">' + usd(r.mcap_usd) + '</td><td class="num">&times;' + (r.mcap_usd / r.tvl_usd).toFixed(3) + '</td></tr>';
    });
    return h + '</tbody></table></section>';
  }
  function excludedHTML() {
    var h = '<section class="card"><h2>Left out on purpose: above the floor, not on the watchlist</h2>' +
      '<p>These record no token and sit above the $50M floor, but the house&rsquo;s rule left them off the watchlist, ' +
      'so they are a wrapped or staked product, or an arm of another protocol. They are not ranked, and the reason is stated, not hidden.</p><ul>';
    D.excluded.forEach(function (r) {
      h += '<li><b>' + esc(r.name) + '</b> (' + esc(r.category || '—') + ', ' + usd(r.tvl_usd) + ') &mdash; ' + esc(r.reason) + '</li>';
    });
    return h + '</ul></section>';
  }

  function detailHTML(row) {
    var g = growthPctOf(row);
    var comps = (D.comps && D.comps[row.category || 'Unknown']) || [];
    var h = '<p><a class="back" href="#/">&larr; Back to the board</a></p>' +
      '<header class="hero"><h1>' + esc(row.name) + '</h1>' +
      '<p class="lede">Rank #' + row.rank + ' &middot; implied value ' + usdFull(impliedLive(row)) +
      ' &middot; ' + verdictBadge(row.verdict) + (row.on_watchlist ? ' <span class="badge watch">watchlist</span>' : '') + '</p>' +
      '<p>' + esc(row.category || 'No category') + ' &middot; ' + esc(row.chains.join(' · ')) + ' &middot; TVL ' + usdFull(row.tvl_usd) + '</p></header>' +
      '<section class="card"><h2>Model breakdown</h2>' +
      '<div class="kv">' +
      '<div><b>' + usdFull(row.tvl_usd) + '</b><span>TVL</span></div>' +
      '<div><b>&times;' + row.multiple.toFixed(3) + '</b><span>category multiple (' + row.comps_n + ' traded comp' + (row.comps_n === 1 ? '' : 's') + ')</span></div>' +
      '<div><b>&times;' + row.growth_multiplier.toFixed(3) + '</b><span>growth tilt (' + pct(g) + ' in 7 days)</span></div>' +
      '<div><b>&times;' + row.maturity_multiplier.toFixed(3) + '</b><span>maturity (' + ageText(row.age_days) + ' tracked)</span></div>' +
      '<div><b>' + usd(impliedLive(row)) + '</b><span>implied value</span></div>' +
      '<div><b>' + usd(row.interval_low_usd) + ' &ndash; ' + usd(row.interval_high_usd) + '</b><span>p25&ndash;p75 multiple interval</span></div>' +
      '<div><b>' + usd(row.global_implied_usd) + '</b><span>value under the global median (&times;' + META.global_multiple.toFixed(3) + ')</span></div>' +
      '<div><b>' + usd(row.farm_cost_usd) + '</b><span>farm plan cost</span></div>' +
      '</div>' +
      '<p class="note">Implied = TVL &times; multiple &times; growth tilt &times; maturity. ' +
      'The multiple is the shrunk category median; with only ' + row.comps_n + ' traded comp' + (row.comps_n === 1 ? '' : 's') +
      ' behind it, treat the global-median value as the honest cross-check.</p>';
    if (comps.length) {
      h += '<h3>Traded comps in ' + esc(row.category || 'this category') + '</h3>' +
        '<table class="board"><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">mcap / TVL</th></tr></thead><tbody>';
      comps.forEach(function (c) {
        h += '<tr><td>' + esc(c.name) + '</td><td class="num">' + usd(c.tvl_usd) + '</td><td class="num">' + usd(c.mcap_usd) + '</td><td class="num">&times;' + c.multiple.toFixed(3) + '</td></tr>';
      });
      h += '</tbody></table>';
    }
    h += '<h3>Farm plan: ' + row.verdict + '</h3>' +
      '<p>Cost ' + usd(row.farm_cost_usd) + ' in total. Breakeven share ' + (row.breakeven_share * 100).toFixed(4) + '% of implied value: ' +
      (row.verdict === 'Farm' ? 'a farmer would need to capture only a tiny share of the implied value to cover the plan, so it is worth farming.' :
        row.verdict === 'Thin' ? 'the plan only pays if the farmer captures a meaningful share, so farm small or wait.' :
        'the plan costs more than a plausible captured share, or the protocol is small and shrinking, so skip it for now.') + '</p>' +
      '<ol class="steps">';
    row.farm_steps.forEach(function (s) { h += '<li>' + esc(s) + '</li>'; });
    h += '</ol></section>';
    return h;
  }
  function renderBoard() {
    var root = document.getElementById('board');
    var list = filteredRows();
    root.innerHTML = heroHTML() + methodHTML() + sandboxHTML() + controlsHTML() + liveHTML() + excludedHTML() +
      '<footer>Snapshot ' + esc(META.as_of) + ' &middot; ' + esc(META.source) +
      '. &ldquo;Records no token&rdquo; follows the snapshot&rsquo;s record; it is not proof a protocol has none. ' +
      'Implied values are this radar&rsquo;s model claims, not prices, and farm costs are stated estimates, not quotes.</footer>';
    document.getElementById('row-count').textContent = list.length + ' of ' + ROWS.length + ' protocols shown.';
    document.getElementById('table-wrap').innerHTML = tableHTML(list);
    bindControls();
    bindSandbox();
    root.querySelectorAll('tbody tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function (ev) {
        if (ev.target.tagName !== 'A') location.hash = '#/p/' + tr.getAttribute('data-slug');
      });
    });
  }
  function renderDetail(slug) {
    var root = document.getElementById('board');
    var row = null;
    ROWS.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) { root.innerHTML = '<p>Unknown protocol: ' + esc(slug) + '.</p><p><a href="#/">&larr; Back to the board</a></p>'; return; }
    root.innerHTML = detailHTML(row);
    window.scrollTo(0, 0);
  }
  function bindControls() {
    var q = document.getElementById('f-q');
    var cat = document.getElementById('f-cat');
    var chain = document.getElementById('f-chain');
    var verdict = document.getElementById('f-verdict');
    var tvl = document.getElementById('f-tvl');
    var sort = document.getElementById('f-sort');
    function refresh() {
      state.q = q.value; state.category = cat.value; state.chain = chain.value;
      state.verdict = verdict.value; state.minTvl = parseInt(tvl.value, 10) || 0; state.sort = sort.value;
      var list = filteredRows();
      document.getElementById('row-count').textContent = list.length + ' of ' + ROWS.length + ' protocols shown.';
      document.getElementById('table-wrap').innerHTML = tableHTML(list);
      document.getElementById('table-wrap').querySelectorAll('tbody tr[data-slug]').forEach(function (tr) {
        tr.addEventListener('click', function (ev) {
          if (ev.target.tagName !== 'A') location.hash = '#/p/' + tr.getAttribute('data-slug');
        });
      });
    }
    q.addEventListener('input', refresh);
    cat.addEventListener('change', refresh);
    chain.addEventListener('change', refresh);
    verdict.addEventListener('change', refresh);
    tvl.addEventListener('change', refresh);
    sort.addEventListener('change', refresh);
  }
  function bindSandbox() {
    function sync() {
      document.getElementById('sb-scale').textContent = sandbox.scale.toFixed(2);
      document.getElementById('sb-gw').textContent = sandbox.growthWeight.toFixed(2);
      document.getElementById('sb-mf').textContent = sandbox.maturityFloor.toFixed(2);
      var list = filteredRows();
      document.getElementById('row-count').textContent = list.length + ' of ' + ROWS.length + ' protocols shown.';
      document.getElementById('table-wrap').innerHTML = tableHTML(list);
    }
    document.getElementById('sb-scale-r').addEventListener('input', function (ev) { sandbox.scale = parseFloat(ev.target.value); sync(); });
    document.getElementById('sb-gw-r').addEventListener('input', function (ev) { sandbox.growthWeight = parseFloat(ev.target.value); sync(); });
    document.getElementById('sb-mf-r').addEventListener('input', function (ev) { sandbox.maturityFloor = parseFloat(ev.target.value); sync(); });
    document.getElementById('sb-reset').addEventListener('click', function () {
      sandbox.scale = 1; sandbox.growthWeight = META.model.growth_weight; sandbox.maturityFloor = META.model.maturity_floor;
      document.getElementById('sb-scale-r').value = '1';
      document.getElementById('sb-gw-r').value = String(META.model.growth_weight);
      document.getElementById('sb-mf-r').value = String(META.model.maturity_floor);
      sync();
    });
  }
  function applyHashFilter(hash) {
    var m = hash.match(/^#\/f\?(.*)$/);
    if (!m) return;
    var params = new URLSearchParams(m[1]);
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('q')) state.q = params.get('q');
    if (params.get('minTvl')) state.minTvl = parseInt(params.get('minTvl'), 10) || 0;
    if (params.get('sort')) state.sort = params.get('sort');
  }
  function route() {
    var hash = location.hash || '#/';
    if (hash.indexOf('#/p/') === 0) { renderDetail(hash.slice(4)); return; }
    applyHashFilter(hash);
    renderBoard();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  route();
})();
