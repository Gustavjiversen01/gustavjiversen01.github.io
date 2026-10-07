/* AI Buildout Graph — plain JS, no build step. Files in web/src are concatenated into app.js. */
"use strict";
const APP = { state: {}, data: null, evidence: null, series: null, idx: {}, tokens: {}, view: null };

const U = {
  esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); },
  num(v, d) {
    if (v == null || Number.isNaN(v)) return "–";
    const a = Math.abs(v);
    if (d == null) d = a >= 100 ? 0 : a >= 10 ? 1 : 2;
    return v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
  },
  unitLabel(u) { const uu = APP.data && APP.data.units && APP.data.units[u]; return uu ? uu.label : (u || ""); },
  fmtVal(v, unit) {
    if (v == null) return "n/a";
    if (unit === "USD_bn") return a(v) >= 1000 ? `$${U.num(v / 1000, 2)}tn` : a(v) < 1 ? `$${U.num(v * 1000, 0)}m` : `$${U.num(v)}bn`;
    if (unit === "pct") return `${U.num(v)}%`;
    if (unit === "ratio") return `${U.num(v * 100, 0)}%`;
    if (unit === "x") return `${U.num(v)}x`;
    if (unit === "bp") return `${U.num(v, 0)} bp`;
    const lab = U.unitLabel(unit);
    return lab ? `${U.num(v)} ${lab}` : U.num(v);
    function a(x) { return Math.abs(x); }
  },
  stat(t) { return t ? { v: t[0], as_of: t[1], conf: t[2], method: t[3], lo: t[4], hi: t[5] } : null; },
  fmtStat(t, unit) {
    const s = U.stat(t); if (!s) return "–";
    let out = U.fmtVal(s.v, unit);
    if (s.lo != null && s.hi != null) out += ` <span class="range">(${U.fmtVal(s.lo, unit)}–${U.fmtVal(s.hi, unit)})</span>`;
    return out;
  },
  asOf(d) { if (!d) return ""; const m = d.match(/^(\d{4})-(\d{2})/); return m ? `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m[2]-1]} ${m[1]}` : d; },
  gradeChip(c) { return c ? `<span class="grade grade-${c}" title="${U.esc(U.gradeName(c))}">${c}</span>` : ""; },
  gradeName(c) { return { A: "A: filing or official dataset", B: "B: company statement or reputable dataset", C: "C: trade press, analyst or market data", D: "D: our estimate" }[c] || ""; },
  methodTag(m) { return m && m !== "measured" ? `<span class="method">${m === "estimated" ? "est." : m}</span>` : ""; },
  debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; },
  on(el, ev, fn) { el.addEventListener(ev, fn); },
  $(sel, root) { return (root || document).querySelector(sel); },
  $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); },
  flag(iso) { return iso || ""; },
  layerOf(id) { return APP.idx.layerById[id]; },
  nodeOf(id) { return APP.idx.nodeById[id]; },
  segment(kind) { return SEGMENT_OF[kind] || "other"; },
};
/* number and unit formatting shared by the panel and the dashboard (moved here from 40_panel.js) */
const Fmt = {
  /* unit -> [[threshold, divisor, label], …], largest first. Anything not listed
     keeps its own label and plain thousands separators. */
  SCALE: {
    t_yr: [[1e6, 1e6, "Mt/yr"], [1e4, 1e3, "kt/yr"]],
    Mt: [[1e3, 1e3, "Gt"]],
    units: [[1e9, 1e9, "bn units"], [1e6, 1e6, "m units"], [1e4, 1e3, "k units"]],
    units_yr: [[1e9, 1e9, "bn units/yr"], [1e6, 1e6, "m units/yr"], [1e4, 1e3, "k units/yr"]],
    k_units: [[1e6, 1e6, "bn units"], [1e3, 1e3, "m units"]],
    M_units: [[1e3, 1e3, "bn units"]],
    systems_yr: [[1e4, 1e3, "k systems/yr"]],
    racks_wk: [[1e4, 1e3, "k racks/week"]],
    MW: [[1e3, 1e3, "GW"]],
    GW: [[1e3, 1e3, "TW"]],
    GW_yr: [[1e3, 1e3, "TW/yr"]],
    TWh: [[1e3, 1e3, "PWh"]],
    kwpm: [[1e3, 1e3, "m wafers/month"]],
    wpm: [[1e6, 1e6, "m wafers/month"], [1e4, 1e3, "k wafers/month"]],
    kwafers: [[1e3, 1e3, "m wafers"]],
    GPUs: [[1e6, 1e6, "m GPUs"], [1e4, 1e3, "k GPUs"]],
    GB: [[1e6, 1e6, "PB"], [1e3, 1e3, "TB"]],
    tokens_bn_day: [[1e3, 1e3, "T tokens/day"]],
  },
  unitKind(unit) { const u = APP.data && APP.data.units && APP.data.units[unit]; return u ? u.kind : null; },
  /* A quantity with its unit, scaled to a magnitude a reader can hold in mind. */
  parts(v, unit) {
    if (v == null || Number.isNaN(v)) return { n: "n/a", u: "" };
    const kind = Fmt.unitKind(unit);
    if (kind === "money" || kind === "price" || kind === "ratio" || ["USD_bn", "pct", "ratio", "x", "bp"].includes(unit)) return { n: U.fmtVal(v, unit), u: "" };
    const rules = Fmt.SCALE[unit];
    if (rules) for (const r of rules) if (Math.abs(v) >= r[0]) return { n: U.num(v / r[1]), u: r[2] };
    return { n: U.num(v), u: U.unitLabel(unit) || "" };
  },
  qty(v, unit) { const p = Fmt.parts(v, unit); return p.u ? `${p.n} ${p.u}` : p.n; },
  /* "3 M units (1–8)" rather than "3 M units (1 M units–8 M units)" */
  range(lo, hi, unit) {
    if (lo == null || hi == null) return "";
    const a = Fmt.parts(lo, unit), b = Fmt.parts(hi, unit);
    return a.u && a.u === b.u ? `${a.n}–${b.n} ${a.u}` : `${Fmt.qty(lo, unit)}–${Fmt.qty(hi, unit)}`;
  },
  /* Percentages that the seed sometimes stores as a ratio and sometimes as a
     percentage. Returns a number in percent, or null. */
  pctOf(v) { return v == null ? null : (Math.abs(v) <= 1.5 ? v * 100 : v); },
  /* True when the value looked like a percentage in a field declared as a ratio. */
  pctSlipped(v) { return v != null && Math.abs(v) > 1.5; },
  pct(v, d) { const p = Fmt.pctOf(v); return p == null ? "n/a" : `${U.num(p, d == null ? 0 : d)}%`; },
  signedPct(v, d) { return v == null ? "n/a" : `${v >= 0 ? "+" : "−"}${U.num(Math.abs(v), d == null ? 0 : d)}%`; },
  /* Growth so large that a percentage stops meaning anything reads better as a multiple. */
  growth(v, suffix) {
    if (v == null) return null;
    if (Math.abs(v) >= 400) return `×${U.num(1 + v / 100, 1)}${suffix || ""}`;
    return `${v >= 0 ? "+" : "−"}${U.num(Math.abs(v), 0)}%${suffix || ""}`;
  },
  /* Shares that overlap or are rounded past 100 in the seed. */
  sharePct(v) {
    if (v == null) return null;
    return v > 100.5 ? ">100%" : `${U.num(v, 0)}%`;
  },
  clamp(v, lo, hi) { return v == null ? null : Math.max(lo, Math.min(hi, v)); },
};

/* seven visual segments of the chain; capital is the side rail */
const SEGMENT_OF = { input: "materials", equipment: "tools", manufacturing: "silicon", compute: "chips", infrastructure: "infra", power: "infra", operator: "operators", model: "operators", consumer: "consumers", capital: "capital" };
const SEGMENT_LABEL = { materials: "Materials", tools: "Tools & optics", silicon: "Wafers, memory, packaging", chips: "Chips & networking", infra: "Power & data centres", operators: "Clouds & labs", consumers: "Token consumers", capital: "Capital" };

/* Small HTML widgets shared by the layer panel and the dashboard. */
const Widgets = {
  gauge(label, pct, colour, sub) {
    const v = pct == null ? null : Math.max(0, Math.min(100, pct));
    return `<div class="gauge"><span class="l">${U.esc(label)}</span><span class="track"><i style="width:${v ?? 0}%;background:${colour}"></i></span><span class="v">${v == null ? "n/a" : U.num(v, 0) + "%"}</span></div>${sub ? `<div class="note" style="font-size:11.5px">${U.esc(sub)}</div>` : ""}`;
  },
  growth(cap, dem, colour) {
    if (cap == null && dem == null) return `<div class="note" style="font-size:12px">Growth versus demand not quantified for this layer yet.</div>`;
    const max = Math.max(Math.abs(cap ?? 0), Math.abs(dem ?? 0), 10);
    const w = x => x == null ? 0 : Math.abs(x) / max * 100;
    const sign = x => x == null ? "n/a" : (x >= 0 ? "+" : "−") + U.num(Math.abs(x), 0) + "%/yr";
    let verdict = "";
    if (cap != null && dem != null) { const gap = cap - dem; verdict = gap >= 0 ? `<span class="verdict ahead">capacity outgrowing demand by ${U.num(gap, 0)} pts</span>` : `<span class="verdict behind">capacity lagging demand by ${U.num(-gap, 0)} pts</span>`; }
    return `<div class="growth"><span class="l">capacity<br>demand</span><div class="bars"><span class="bar cap" style="width:${w(cap)}%;background:${colour}"></span><span class="bar dem" style="width:${w(dem)}%;background:${colour}"></span></div><span class="val">${sign(cap)}<br>${sign(dem)}</span></div>${verdict ? `<div>${verdict}</div>` : ""}`;
  },
  risks(list, max) {
    const order = { high: 0, med: 1, low: 2 }; /* rank, not truthiness: `order[s] || 3` would break high */
    const rows = [...(list || [])].sort((a, b) => order[a.severity] - order[b.severity]).slice(0, max || 99);
    if (!rows.length) return `<div class="note">No layer risks recorded.</div>`;
    const src = APP.data.sources;
    return `<ul class="risks">${rows.map(r => { const s = src[r.src]; const url = s && s.url && s.url.startsWith("http") ? s.url : null; return `<li><span class="sev sev-${r.severity}">${r.severity}</span><span>${U.esc(r.text)} <span class="src">${U.gradeChip(r.conf)} ${url ? `<a href="${U.esc(url)}" target="_blank" rel="noopener">${U.esc(s.publisher || s.title)}</a>` : (s && ((s.url || "").startsWith("file:") || /unpublished/.test(s.publisher || "")) ? "Author's research note" : U.esc(s ? s.title : r.src))}</span></span></li>`; }).join("")}</ul>`;
  },
  sparkline(points, colour) {
    if (!points || points.length < 2) return "";
    const ys = points.map(p => p[1]);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const W = 150, H = 30, pad = 3, gutter = 34; /* min/max labels live in a gutter to the right of the plot */
    const sx = i => pad + (i / (points.length - 1)) * (W - gutter - 2 * pad);
    const sy = v => maxY === minY ? H / 2 : H - pad - ((v - minY) / (maxY - minY)) * (H - 2 * pad);
    const d = points.map((p, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(" ");
    const last = points[points.length - 1];
    const fmt = v => Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + "k" : Math.abs(v) >= 100 ? String(Math.round(v)) : Number(v).toFixed(1);
    const lab = maxY === minY ? "" : `<text x="${W - 2}" y="9" text-anchor="end" style="font-size:8px;fill:var(--c-ink-3)">${fmt(maxY)}</text><text x="${W - 2}" y="${H - 2}" text-anchor="end" style="font-size:8px;fill:var(--c-ink-3)">${fmt(minY)}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="${colour}" stroke-width="1.8"/><circle cx="${sx(points.length - 1).toFixed(1)}" cy="${sy(last[1]).toFixed(1)}" r="2.6" fill="${colour}"/>${lab}</svg>`;
  },

  sparkRows(layerId, colour) {
    const rows = (APP.data.views.dashboard || {})[layerId] || [];
    if (!rows.length) return "";
    return `<div class="spark">${rows.map(r => { const last = r.points[r.points.length - 1]; const first = r.points[0]; return `<div class="row"><span>${U.esc(r.name)} · ${U.esc(r.key.replace(/_/g, " "))}<br><span class="last">${U.fmtVal(last[1], r.unit)}</span> <span style="color:var(--c-ink-3)">${first[0]} → ${last[0]}</span></span>${Widgets.sparkline(r.points, colour)}</div>`; }).join("")}</div>`;
  },
  finTiles(fin) {
    if (!fin) return "";
    const t = (l, v, f) => v == null ? "" : `<div class="fin"><div class="l">${l}</div><div class="v">${f(v)}</div></div>`;
    return `<div class="layer-fin">${t("Price / expected earnings, median", fin.pe_fwd_median, v => U.num(v, 1) + "x")}${t("Price / expected earnings, cap-weighted", fin.pe_fwd_wavg, v => U.num(v, 1) + "x")}${t("Price / last year's earnings, median", fin.pe_ttm_median, v => U.num(v, 1) + "x")}${t("Market value, sum (live)", fin.mcap_sum_usd_bn, v => U.fmtVal(v, "USD_bn"))}${t("Growth, median", fin.growth_median_pct, v => U.num(v, 0) + "%")}${t("Gross margin, median", fin.gm_median_pct, v => U.num(v, 0) + "%")}${t("Below 1-year high, median", fin.drawdown_median_pct, v => U.num(v, 0) + "%")}${t("Listed names", fin.n_listed, v => `${v} (${fin.pe_fwd_n} with expected earnings)`)}</div>`;
  },
};
/* URL-hash state: #v=map&n=id&q=..&c=ISO&o=own&k=segment&bn=3&dk=1 */
const State = {
  defaults() { return { view: "overview", node: null, layer: null, q: "", country: "", own: "", kind: "", bn: "", dk: false }; },
  read() {
    const s = State.defaults();
    const h = location.hash.replace(/^#/, "");
    if (!h) return s;
    for (const part of h.split("&")) {
      const [k, v] = part.split("=").map(decodeURIComponent);
      if (k === "ch") { APP.chain = v || ""; continue; }
      if (k === "v") s.view = v; else if (k === "n") s.node = v; else if (k === "l") s.layer = v; else if (k === "q") s.q = v; else if (k === "c") s.country = v;
      else if (k === "o") s.own = v; else if (k === "k") s.kind = v; else if (k === "bn") s.bn = v; else if (k === "dk") s.dk = v === "1";
    }
    return s;
  },
  write() {
    const s = APP.state; const parts = [];
    if (APP.chain) parts.push(`ch=${encodeURIComponent(APP.chain)}`);
    if (s.view && s.view !== "overview") parts.push(`v=${s.view}`);
    if (s.node) parts.push(`n=${encodeURIComponent(s.node)}`);
    if (s.layer) parts.push(`l=${encodeURIComponent(s.layer)}`);
    if (s.q) parts.push(`q=${encodeURIComponent(s.q)}`);
    if (s.country) parts.push(`c=${s.country}`);
    if (s.own) parts.push(`o=${s.own}`);
    if (s.kind) parts.push(`k=${s.kind}`);
    if (s.bn) parts.push(`bn=${s.bn}`);
    if (s.dk) parts.push(`dk=1`);
    const next = parts.length ? "#" + parts.join("&") : "";
    if (next !== location.hash) history.replaceState(null, "", next || location.pathname + location.search);
  },
  set(patch) { Object.assign(APP.state, patch); State.write(); Boot.render(); },
};
/* Read CSS tokens so the canvas paints with the same palette as the DOM, in both themes. */
const Theme = {
  read() {
    const cs = getComputedStyle(document.documentElement);
    const t = {};
    for (const k of ["bg", "surface", "ink", "ink-2", "ink-3", "line", "accent", "accent-soft", "warn", "band", "band-alt", "edge", "edge-strong"]) t[k] = cs.getPropertyValue(`--c-${k}`).trim();
    for (const g of ["A", "B", "C", "D"]) t[`grade-${g}`] = cs.getPropertyValue(`--grade-${g}`).trim();
    for (const seg of Object.keys(SEGMENT_LABEL)) t[`seg-${seg}`] = cs.getPropertyValue(`--seg-${seg}`).trim();
    APP.tokens = t;
    return t;
  },
  watch(onChange) {
    const mo = new MutationObserver(() => { Theme.read(); onChange(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    (mq.addEventListener ? mq.addEventListener("change", () => { Theme.read(); onChange(); }) : mq.addListener(() => { Theme.read(); onChange(); }));
  },
};
const Data = {
  url(name) { return (APP.chain ? APP.chain.replace(/[^a-z0-9_-]/gi, "") + "/" : "") + name; },
  async load() {
    const m = location.hash.match(/(?:^#|&)ch=([^&]*)/); APP.chain = m ? decodeURIComponent(m[1]) : "";
    const r = await fetch(Data.url("graph.json"), { cache: "no-cache" });
    if (!r.ok) throw new Error(`${Data.url("graph.json")} ${r.status}`);
    APP.data = await r.json();
    if (APP.data.meta && APP.data.meta.segment_labels) Object.assign(SEGMENT_LABEL, APP.data.meta.segment_labels);
    if (APP.data.meta && APP.data.meta.segment_colours) for (const [k, v] of Object.entries(APP.data.meta.segment_colours)) document.documentElement.style.setProperty(`--seg-${k}`, v);
    Data.index();
  },
  async ensureEvidence() {
    if (APP.evidence) return APP.evidence;
    const r = await fetch(Data.url("evidence.json"), { cache: "no-cache" });
    APP.evidence = r.ok ? await r.json() : {};
    return APP.evidence;
  },
  async ensureSeries() {
    if (APP.series) return APP.series;
    const r = await fetch(Data.url("series.json"), { cache: "no-cache" });
    APP.series = r.ok ? await r.json() : {};
    return APP.series;
  },
  index() {
    const g = APP.data;
    const nodeById = {}; const layerById = {}; const out = {}; const inn = {}; const byLayer = {};
    for (const l of g.layers) { layerById[l.id] = l; byLayer[l.id] = []; }
    for (const n of g.nodes) { nodeById[n.id] = n; (byLayer[n.layer] = byLayer[n.layer] || []).push(n); out[n.id] = []; inn[n.id] = []; }
    for (const e of g.edges) { if (out[e.s]) out[e.s].push(e); if (inn[e.t]) inn[e.t].push(e); }
    const search = g.nodes.map(n => ({ id: n.id, key: [n.name, n.tk, ...(n.aliases || [])].filter(Boolean).join(" ").toLowerCase() }));
    const countries = new Set(g.nodes.map(n => n.hq));
    APP.idx = { nodeById, layerById, out, inn, byLayer, search, countries: Array.from(countries).sort() };
  },
  passes(n) {
    const s = APP.state;
    if (s.country && n.hq !== s.country) return false;
    if (s.own && n.own !== s.own) return false;
    if (s.kind && U.segment(U.layerOf(n.layer).kind) !== s.kind) return false;
    if (s.bn && !(n.bn && n.bn.effective != null && n.bn.effective >= +s.bn)) return false;
    if (s.dk && !(["DNK", "SWE", "NOR", "FIN", "ISL"].includes(n.hq) || (n.tags || []).some(t => t === "denmark" || t === "nordic"))) return false;
    if (s.q) { const q = s.q.toLowerCase(); const rec = APP.idx.search.find(r => r.id === n.id); if (!rec || !rec.key.includes(q)) return false; }
    return true;
  },
  find(q) {
    q = q.trim().toLowerCase(); if (!q) return [];
    return APP.idx.search.filter(r => r.key.includes(q)).slice(0, 12).map(r => APP.idx.nodeById[r.id]);
  },
};
/* Live market data. A GitHub Actions job on the website repo writes live.json every 10 minutes
   (Yahoo quotes, no key). Live.start() loads it, overwrites each listed node's market cap with the
   live figure (fin.mcap method "live"), scales trailing and forward P/E by the price move, adjusts the
   layer market-cap sums, and calls every Live.on() subscriber. Without live.json the page shows the
   build's figures and the live badges stay hidden. */
const Live = {
  data: null, ready: false, subs: [], ref: {}, layerRef: {}, POLL_MS: 120000,
  url() { return (APP.data.meta && APP.data.meta.live_url) || "live.json"; },
  on(fn) { Live.subs.push(fn); if (Live.ready) { try { fn(Live.data); } catch (e) { console.error(e); } } },
  async start() {
    for (const n of APP.data.nodes) if (n.fin && n.fin.mcap) Live.ref[n.id] = { mcap: n.fin.mcap.slice(), pe: n.fin.pe && n.fin.pe.slice(), pe_fwd: n.fin.pe_fwd && n.fin.pe_fwd.slice() };
    for (const l of APP.data.layers) { const f = (l.totals || {}).fin; if (f && f.mcap_sum_usd_bn != null) Live.layerRef[l.id] = f.mcap_sum_usd_bn; }
    const sources = [Live.url()]; if (sources[0] !== "live.json") sources.push("live.json");
    await Live.fetch(sources);
    setInterval(() => { if (!document.hidden) Live.fetch([Live.url()]); }, Live.POLL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && Live.data && Date.now() / 1000 - Live.data.t > 300) Live.fetch([Live.url()]); });
  },
  async fetch(urls) {
    for (const u of urls) {
      try {
        const r = await fetch(u, { cache: "no-cache" }); if (!r.ok) continue;
        const d = await r.json(); if (!d || !d.q) continue;
        if (Live.data && d.t <= Live.data.t) return;
        Live.apply(d); return;
      } catch (e) { /* try the next source */ }
    }
  },
  apply(d) {
    const prev = Live.data; Live.data = d; Live.byId = {};
    const date = new Date(d.t * 1000).toISOString().slice(0, 10);
    for (const [sym, q] of Object.entries(d.q)) for (const id of q.i || []) Live.byId[id] = Object.assign({ sym }, q);
    const layerDelta = {};
    for (const n of APP.data.nodes) {
      const q = Live.byId[n.id], ref = Live.ref[n.id]; if (!q || !ref) continue;
      const ratio = q.m / ref.mcap[0];
      n.fin.mcap = [q.m, date, "C", "live"];
      if (ref.pe) n.fin.pe = [ref.pe[0] * ratio, date, ref.pe[2], "live"];
      if (ref.pe_fwd) n.fin.pe_fwd = [ref.pe_fwd[0] * ratio, date, ref.pe_fwd[2], "live"];
      layerDelta[n.layer] = (layerDelta[n.layer] || 0) + q.m - ref.mcap[0];
    }
    for (const l of APP.data.layers) if (Live.layerRef[l.id] != null) l.totals.fin.mcap_sum_usd_bn = Live.layerRef[l.id] + (layerDelta[l.id] || 0);
    Live.ready = true;
    Live.badge();
    for (const fn of Live.subs) { try { fn(d, prev); } catch (e) { console.error(e); } }
  },
  /* ---- read helpers for views ---- */
  node(id) { return (Live.byId && Live.byId[id]) || null; },
  /* cap-weighted move today over a set of nodes, counting each symbol once */
  today(nodes) {
    if (!Live.ready) return null; const seen = new Set(); let m = 0, m0 = 0, n = 0;
    for (const x of nodes) { const q = Live.node(x.id); if (!q || seen.has(q.sym)) continue; seen.add(q.sym); m += q.m; m0 += q.m / (1 + q.c / 100); n++; }
    return n ? { m, c: (m / m0 - 1) * 100, n } : null;
  },
  layerToday(layerId) { return Live.today(APP.data.nodes.filter(n => n.layer === layerId)); },
  countryToday(iso) { return Live.today(APP.data.nodes.filter(n => n.hq === iso)); },
  market(key) { const d = Live.data; return d && d.mk && d.mk[key] ? Object.assign({ key }, d.mk[key]) : null; },
  markets() { return Live.data && Live.data.mk ? Object.keys(Live.data.mk).map(Live.market) : []; },
  marketsFor(layerId) { return Live.markets().filter(m => (m.layers || []).includes(layerId)); },
  history(key) { const d = Live.data; if (!d) return []; return key ? ((d.mh || {})[key] || []) : (d.h || []); },
  /* ---- formatting ---- */
  chg(c, opts = {}) {
    if (c == null || !isFinite(c)) return "";
    const cls = Math.abs(c) < 0.005 ? "flat" : c > 0 ? "up" : "down";
    const txt = opts.bp ? `${c > 0 ? "+" : c < 0 ? "−" : ""}${Math.abs(c).toFixed(0)} bp` : `${c > 0 ? "+" : c < 0 ? "−" : ""}${Math.abs(c).toFixed(2)}%`;
    return `<span class="live-chg ${cls}" title="${opts.title || "Change since the previous close"}">${txt}</span>`;
  },
  marketValue(mk) {
    if (!mk) return "";
    if (mk.kind === "yield") return `${mk.v.toFixed(2)}%`;
    const v = mk.v, d = v >= 1000 ? 0 : v >= 100 ? 1 : 2;
    const s = v.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
    return mk.unit === "USD" ? `$${s}` : mk.unit ? `${s} <span class="live-unit">${mk.unit.replace("USD/", "$/").replace("EUR/", "€/")}</span>` : s;
  },
  marketChg(mk) { return mk.kind === "yield" ? Live.chg((mk.v - mk.pc) * 100, { bp: true }) : Live.chg(mk.c); },
  dot() { return `<span class="live-dot" aria-hidden="true"></span>`; },
  ago(t) {
    t = t || (Live.data && Live.data.t); if (!t) return ""; const s = Date.now() / 1000 - t;
    if (s < 90) return "just now"; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  },
  isOpen(q) { return q && q.ts && Date.now() / 1000 - q.ts < 1800; },
  spark(points, w = 120, h = 28) {
    if (!points || points.length < 2) return "";
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sx = t => ((t - x0) / (x1 - x0 || 1)) * w, sy = v => h - 2 - ((v - y0) / (y1 - y0 || 1)) * (h - 4);
    const dpath = points.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join("");
    const up = ys[ys.length - 1] >= ys[0];
    return `<svg class="live-spark ${up ? "up" : "down"}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${dpath}"/></svg>`;
  },
  /* topbar badge: pulse + "Live · updated 4 min ago" */
  badge() {
    const el = U.$("#live-badge"); if (!el || !Live.data) return;
    const d = Live.data, idx = d.idx || {};
    el.hidden = false;
    const fresh = Date.now() / 1000 - d.t < 3 * 3600;
    el.classList.toggle("stale", !fresh);
    el.innerHTML = `${Live.dot()}<span class="lb-label">${fresh ? "Live" : "Markets"}</span><span class="lb-val">$${U.num(idx.m / 1000, 2)}tn</span>${Live.chg(idx.c, { title: "Listed companies in the chain, change since each market's previous close" })}`;
    el.title = `Market data for ${d.n} listed companies and 18 market signals, from Yahoo Finance quotes (some exchanges delayed by 15 to 20 minutes). Updated ${Live.ago()}; refreshes about every 10 minutes on weekdays.`;
    clearInterval(Live._agoTimer); Live._agoTimer = setInterval(() => { const a = U.$$(".live-ago"); a.forEach(x => { x.textContent = Live.ago(); }); }, 30000);
  },
  /* flash numbers that changed: call after re-rendering with the previous payload */
  flash(root) { U.$$(".live-chg, .live-num", root || document).forEach(e => { e.classList.remove("flash"); void e.offsetWidth; e.classList.add("flash"); }); },
};
/* Shared formatting for the panel and the map's gutter cards.
   Two jobs: keep raw figures readable (97,690,837 t/yr reads 97.7 Mt/yr), and
   catch the unit slips that exist in the seed (a "ratio" stored as 83.5 rather
   than 0.835) so the UI never prints 8,350%. */

const Panel = {
  el() { return U.$("#panel"); },
  close() {
    const el = Panel.el();
    const wasInside = el && el.contains(document.activeElement);
    State.set({ node: null, layer: null });
    /* keyboard users came in from the map; send them back to it */
    if (wasInside) { const c = U.$("#map-canvas"); if (c && !U.$("#view-map").hidden) c.focus(); }
  },
  /* A new subject means a new read: start at the top of the panel, and if the
     reader arrived by keyboard put focus on the panel so it is announced. */
  _open(el, key) {
    const fresh = Panel._key !== key;
    Panel._key = key;
    el.hidden = false;
    if (!fresh) return;
    el.scrollTop = 0;
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    const a = document.activeElement;
    if (a && (a.id === "map-canvas" || (a.closest && a.closest("#panel")))) el.focus({ preventScroll: true });
  },
  async render() {
    if (!Panel._liveBound && typeof Live !== "undefined") {
      Panel._liveBound = true;
      Live.on(() => setTimeout(() => { const id = APP.state.node; if (id && Live.node(id) && !Panel.el().hidden) { Panel.render().then(() => Live.flash(Panel.el())); } else if (APP.state.layer && !Panel.el().hidden) Panel.render(); }, 0));
    }
    const id = APP.state.node; const el = Panel.el();
    if (!id && APP.state.layer && U.layerOf(APP.state.layer)) {
      Panel._open(el, "l:" + APP.state.layer);
      U.$("#panel-inner").innerHTML = Panel.layer(U.layerOf(APP.state.layer)); Panel.bind(U.$("#panel-inner")); return;
    }
    if (!id || !U.nodeOf(id)) { el.hidden = true; Panel._key = null; return; }
    const n = U.nodeOf(id); const lay = U.layerOf(n.layer); const seg = U.segment(lay.kind);
    Panel._open(el, "n:" + id);
    const inner = U.$("#panel-inner");
    inner.innerHTML = Panel.skeleton(n, lay, seg);
    const ev = await Data.ensureEvidence();
    if (APP.state.node !== id) return;
    U.$("#panel-evidence").innerHTML = Panel.evidence(n, ev[id] || { stats: [], claims: [] });
    Panel.bind(inner);
  },
  /* ---- plain words for grades, methods and figure names ---- */
  GRADE_WORD: { A: "official", B: "company", C: "press or market", D: "our estimate" },
  GRADE_HELP: {
    A: "Grade A: a filing, statute or official statistic.",
    B: "Grade B: the company's own statement, or a reputable industry dataset.",
    C: "Grade C: trade press, an analyst, or market data.",
    D: "Grade D: our estimate, triangulated from other sourced figures. No published number yet.",
  },
  grade(c) {
    if (!c) return "";
    const word = c === "D" ? "our estimate" : `${c} · ${Panel.GRADE_WORD[c] || ""}`;
    return `<span class="grade grade-${c}" title="${U.esc(Panel.GRADE_HELP[c] || "")}">${word}</span>`;
  },
  METHOD_WORD: { estimated: "estimated", guided: "company guidance", fetched: "market data", derived: "derived", live: "live", measured: "" },
  method(m) { const w = Panel.METHOD_WORD[m]; return w ? `<span class="method">${w}</span>` : ""; },
  PATH_WORD: {
    "financials.market_cap_usd_bn": "Market value", "financials.pe_fwd": "Price / expected earnings", "financials.pe_ttm": "Price / last year's earnings",
    "financials.revenue_q_usd_bn": "Revenue, latest quarter", "financials.revenue_ttm_usd_bn": "Revenue, last 12 months", "financials.valuation_usd_bn": "Private valuation",
    "financials.revenue_growth_yoy": "Revenue growth, year on year", "financials.gross_margin": "Gross margin", "financials.arr_usd_bn": "Annual recurring revenue",
    "financials.revenue_guide_usd_bn": "Revenue guidance", "financials.capex_guide_usd_bn": "Capital spending guidance", "financials.capex_ttm_usd_bn": "Capital spending, last 12 months",
    "financials.drawdown_from_1y_high_pct": "Below 1-year high", "financials.total_debt_usd_bn": "Total debt", "financials.net_debt_usd_bn": "Net debt",
    "financials.run_rate_usd_bn": "Revenue run-rate", "financials.ebitda_usd_bn": "EBITDA", "financials.cds_5y_bp": "Credit default swap, 5-year",
    "capacity.current": "Capacity", "capacity.share_of_layer_pct": "Share of its market", "capacity.backlog_value_usd_bn": "Order backlog",
    "capacity.utilization": "Capacity in use", "capacity.lead_time_weeks": "Lead time", "capacity.book_to_bill": "Orders / shipments", "capacity.backlog_units": "Order backlog, units",
    "demand_class.reflexive_fraction": "Share of spending funded by the AI boom itself",
  },
  pathWord(p) {
    if (Panel.PATH_WORD[p]) return Panel.PATH_WORD[p];
    let m = p.match(/^capacity\.planned\[(\d+)\]$/); if (m) return `Planned capacity added in ${m[1]}`;
    m = p.match(/^customers\[\d+\]\.share_of_revenue$/); if (m) return "Customer's share of revenue";
    const last = p.split(".").pop().replace(/_/g, " ").replace(/\busd bn\b/, "").trim();
    return last.charAt(0).toUpperCase() + last.slice(1);
  },
  /* sources: a local file is the author's own note, never a link */
  srcHtml(id) {
    const s = APP.data.sources[id]; if (!s) return U.esc(id);
    const url = s.url || "";
    if (url.startsWith("file:")) return `<span class="src-note" title="${U.esc(s.title)}">Author's research note (unpublished)</span>${s.date ? ` · ${U.esc(Panel.date(s.date))}` : ""}`;
    const pub = s.publisher && !/internal/i.test(s.publisher) ? ` · ${U.esc(s.publisher)}` : "";
    const t = url.startsWith("http") ? `<a href="${U.esc(url)}" target="_blank" rel="noopener">${U.esc(s.title)}</a>` : U.esc(s.title);
    return `${t}${pub}${s.date ? ` · ${U.esc(Panel.date(s.date))}` : ""}`;
  },
  date(d) {
    const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${+m[3]} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m[2] - 1]} ${m[1]}` : String(d || "");
  },
  OWN: { public: "Listed", private: "Private", subsidiary: "Subsidiary", state: "State-owned", foundation: "Foundation-owned", cooperative: "Cooperative" },
  TYPE: { segment: "Market segment", product: "Product", resource: "Raw material", fund: "Fund" },

  skeleton(n, lay, seg) {
    const esc = U.esc, fin = n.fin || {}, cap = n.cap || {};
    const tile = (label, help, t, unit, fmt) => {
      if (!t) return null; const s = U.stat(t);
      const f = fmt || (v => Fmt.qty(v, unit));
      let v = s.v == null ? '<span class="na" title="The source does not disclose this figure">not disclosed</span>' : f(s.v);
      if (s.v != null && s.lo != null && s.hi != null) v += ` <span class="range">(${fmt ? `${f(s.lo)} to ${f(s.hi)}` : Fmt.range(s.lo, s.hi, unit).replace("–", " to ")})</span>`;
      const live = s.method === "live";
      const meta = [live ? `<span class="live-tag">${typeof Live !== "undefined" ? Live.dot() : ""}live</span>` : U.asOf(s.as_of), live ? "" : Panel.grade(s.conf), live ? "" : Panel.method(s.method)].filter(Boolean).join(" ");
      return `<div class="pk" title="${esc(help)}"><div class="pk-l">${esc(label)}</div><div class="pk-v${live ? " live-num" : ""}">${v}</div>${meta ? `<div class="pk-m">${meta}</div>` : ""}</div>`;
    };
    const usd = v => U.fmtVal(v, "USD_bn");
    const pct = v => `${U.num(Fmt.pctOf(v) != null && Math.abs(v) <= 1.5 ? v * 100 : v, 0)}%`;
    const all = [
      fin.mcap ? tile("Market value", "Stock-market value of the whole company (market capitalisation), in US dollars.", fin.mcap, "USD_bn", usd) : tile("Private valuation", "Value at the latest private funding round or deal.", fin.val, "USD_bn", usd),
      tile("Price / expected earnings", "Forward P/E: share price divided by the earnings analysts expect over the next 12 months. Lower means cheaper relative to profits.", fin.pe_fwd, "x", v => `${U.num(v, 1)}×`),
      tile("Revenue, latest quarter", "Sales in the most recent reported quarter.", fin.rev_q, "USD_bn", usd),
      tile("Revenue run-rate", "Current revenue pace, annualised.", fin.run_rate, "USD_bn", usd),
      tile("Revenue growth", "Revenue growth over the same period a year earlier.", fin.growth, "pct", v => `${U.num(v, 0)}%`),
      tile("Gross margin", "Share of revenue left after the direct cost of making the product.", fin.gm, "pct", v => `${U.num(v, 0)}%`),
      tile("Share of its market", "Estimated share of this company's product market.", cap.share, "pct", v => Fmt.sharePct(v)),
      tile(`Capacity${cap.role === "tenant" ? " (rented)" : ""}`, cap.basis ? `Counts: ${cap.basis}` : "Production capacity.", cap.cur, cap.unit),
      tile("Annual recurring revenue", "Subscription revenue on an annual basis.", fin.arr, "USD_bn", usd),
      tile("Revenue guidance", "The company's own forecast for the next period.", fin.rev_g, "USD_bn", usd),
      tile("Capital spending guidance", "Planned capital expenditure, as guided by the company.", fin.capex_g, "USD_bn", usd),
      tile("Order backlog", "Value of orders taken but not yet delivered.", cap.backlog, "USD_bn", usd),
      tile("Capacity in use", "Utilisation: how much of the installed capacity is running.", cap.util, "ratio", v => Fmt.pct(v, 0)),
      tile("Lead time", "How long a new order waits before delivery.", cap.lt, "weeks"),
      tile("Orders / shipments", "Book-to-bill: above 1 means orders arrive faster than they ship.", cap.b2b, "x", v => `${U.num(v, 2)}×`),
      tile("Below 1-year high", "How far the share price sits below its 12-month high.", fin.dd, "pct", v => `${U.num(v, 0)}%`),
      tile("Total debt", "Borrowings on the balance sheet.", fin.debt, "USD_bn", usd),
      tile("Net debt", "Debt minus cash.", fin.net_debt, "USD_bn", usd),
      tile("Credit default swap, 5-year", "Annual cost, in basis points, of insuring the company's debt against default. Higher means markets see more risk.", fin.cds, "bp"),
      cap.backlog_u ? tile("Order backlog, units", "Units ordered but not yet delivered.", cap.backlog_u, cap.unit) : null,
    ].filter(Boolean);
    const key = all.slice(0, 6), more = all.slice(6);
    const metrics = all.length
      ? `<div class="pk-grid">${key.join("")}</div>${more.length ? `<details class="p-more"><summary>${more.length} more figure${more.length > 1 ? "s" : ""}</summary><div class="pk-grid">${more.join("")}</div></details>` : ""}`
      : `<p class="note">No published figures yet; see the evidence below.</p>`;

    /* live quote */
    const q = typeof Live !== "undefined" && Live.ready ? Live.node(n.id) : null;
    const liveHtml = q ? `<div class="p-live" title="Yahoo Finance quote for ${esc(q.sym)}; some exchanges are delayed 15 to 20 minutes. Market value and P/E above move with the price.">
      <span class="pl-tag">${Live.dot()}Live</span><span class="pl-sym">${esc(q.sym)}</span><span class="pl-p live-num">${U.num(q.p, q.p >= 100 ? 2 : 2)}</span>${Live.chg(q.c)}<span class="pl-ago">updated <span class="live-ago">${Live.ago(q.ts)}</span></span></div>` : "";

    const bn = n.bn || {};
    const inputs = ["U", "L", "B", "C", "A", "R", "S"].filter(k => bn.inputs && bn.inputs[k] != null);
    const bnHtml = bn.effective != null ? `<section class="p-sec"><h4 title="How hard it is to get more of what this company makes: 0 is plenty of slack, 5 is sold out with few alternatives. Our calculation from sourced inputs.">Bottleneck score</h4>
      <div class="p-score"><span class="ps-v">${bn.effective}<span class="ps-of"> of 5</span></span><div class="meter"><i style="width:${(bn.effective / 5) * 100}%;background:var(--seg-${seg})"></i></div></div>
      <p class="p-small">Our calculation${bn.override != null ? " (set by hand)" : ""}, confidence ${Math.round((bn.confidence || 0) * 100)}%${bn.relief_year ? `, relief expected ${bn.relief_year}` : ""}. Based on: ${inputs.map(k => Panel.inputName(k).toLowerCase()).join(", ") || "few inputs"}.</p>
      ${bn.rationale ? `<p class="note">${esc(bn.rationale)}</p>` : ""}</section>` : "";
    const dcWord = { unbounded: "Open-ended demand: spends more as models improve", bounded: "Bounded demand: a fixed task, spending caps out" };
    const dc = n.dc ? `<section class="p-sec"><h4>What drives its AI spending</h4><ul class="p-facts">
      <li>${esc(dcWord[n.dc.b] || n.dc.b)}</li><li>${esc(n.dc.h === "long" ? "Long horizon: commitments run for years" : "Short horizon: can cut back quickly")}</li>
      <li>Dependence on frontier models: ${esc(n.dc.fd === "med" ? "medium" : n.dc.fd)}</li>
      ${n.dc.rf ? `<li title="Share of this company's AI spending that is itself funded by AI-boom money (venture capital, AI revenue) rather than by outside customers.">Share of spending funded by the AI boom itself: <b>${U.fmtStat(n.dc.rf, "ratio")}</b> ${Panel.grade(n.dc.rf[2])}</li>` : ""}</ul>
      ${n.dc.why ? `<p class="note">${esc(n.dc.why)}</p>` : ""}</section>` : "";
    const planned = (cap.planned || []).length ? Panel.planned(n) : "";

    /* connections in plain words, grouped */
    const groups = [
      ["Suppliers", e => e.k === "supplies" && e.t === n.id, e => e.s], ["Customers", e => e.k === "supplies" && e.s === n.id, e => e.t],
      ["Buys AI tokens from", e => e.k === "consumes_tokens" && e.s === n.id, e => e.t], ["Sells AI tokens to", e => e.k === "consumes_tokens" && e.t === n.id, e => e.s],
      ["Leases from", e => e.k === "leases" && e.t === n.id, e => e.s], ["Leases to", e => e.k === "leases" && e.s === n.id, e => e.t],
      ["Financed by", e => e.k === "finances" && e.t === n.id, e => e.s], ["Finances", e => e.k === "finances" && e.s === n.id, e => e.t],
      ["Owned by", e => e.k === "owns" && e.t === n.id, e => e.s], ["Owns", e => e.k === "owns" && e.s === n.id, e => e.t],
    ];
    const edges = [...(APP.idx.inn[n.id] || []), ...(APP.idx.out[n.id] || [])];
    const connRows = groups.map(([label, test, other]) => {
      const es = edges.filter(test); if (!es.length) return "";
      return `<div class="p-conn"><div class="pc-l">${label} <span class="pc-n">${es.length}</span></div><div class="pc-list">${es.map(e => { const o = U.nodeOf(other(e)); return `<button data-go="${esc(other(e))}" title="${esc([e.p, e.note].filter(Boolean).join(": "))}">${esc(o ? o.name : other(e))}${e.p ? `<span class="pc-p">${esc(e.p)}</span>` : ""}</button>`; }).join("")}</div></div>`;
    }).join("");
    const conns = connRows ? `<section class="p-sec"><h4>Connections</h4>${connRows}</section>` : "";
    const parent = n.parent && U.nodeOf(n.parent) ? `<button class="p-link" data-go="${n.parent}">Part of ${esc(U.nodeOf(n.parent).name)}</button>` : "";

    const cat = typeof MapView !== "undefined" && MapView.catName ? MapView.catName(n.cat) : (n.cat || "").replace(/_/g, " ");
    const role = `${Panel.TYPE[n.type] ? Panel.TYPE[n.type] + " · " : ""}${cat && cat.toLowerCase() !== "market" ? esc(cat) + " in " : ""}<button class="p-link" data-layer="${lay.id}" title="Open this layer">${esc(lay.name)}</button>`;
    const ids = [n.tk ? `<span class="tk">${esc(n.tk)}${n.ex ? ` · ${esc(n.ex)}` : ""}</span>` : `<span>${Panel.OWN[n.own] || esc(n.own)}</span>`,
      n.hq ? `<span>${esc(typeof MapView !== "undefined" && MapView.countryName ? MapView.countryName(n.hq) : n.hq)}</span>` : "", n.rating ? `<span title="Credit rating">${esc(n.rating)}</span>` : "", parent].filter(Boolean).join("");
    const navLinks = APP.state.view !== "map" ? `<div class="panel-nav-links"><button class="panel-nav-btn" data-nav="map">Show on the map</button></div>` : "";
    return `
      <div class="panel-drag-handle" aria-hidden="true"></div>
      <header class="p-head" style="--seg:var(--seg-${seg})">
        <div class="p-eyebrow"><i class="dot" style="background:var(--seg-${seg})"></i>${esc(SEGMENT_LABEL[seg] || "")}</div>
        <h2>${esc(n.name)}</h2>
        <button class="close" aria-label="Close panel" data-close>×</button>
        <p class="p-role">${role}</p>
        <div class="p-ids">${ids}</div>
      </header>
      ${liveHtml}
      ${n.sum ? `<p class="p-sum">${esc(n.sum)}</p>` : ""}
      <section class="p-sec"><h4>Key figures</h4>${metrics}</section>
      ${bnHtml}${dc}${planned}
      ${conns}
      <section class="p-sec" id="panel-evidence"><h4>Evidence</h4><p class="note">Loading…</p></section>
      ${navLinks}`;
  },
  inputName(k) {
    const names = { U: "Utilization", L: "Lead time", B: "Backlog cover", C: "Concentration", A: "Substitutability", R: "Relief distance", S: "Upstream rationing" };
    return names[k] || k;
  },
  isStale(n, path) { return (n.stale || []).includes(path); },
  layer(lay) {
    const t = lay.totals || {}; const seg = U.segment(lay.kind); const col = `var(--seg-${seg})`; const f = t.fin || {};
    const tile = (l, v, sub, title) => v == null || v === "" ? "" : `<div class="stat"${title ? ` title="${U.esc(title)}"` : ""}><div class="l">${l}</div><div class="v">${v}</div>${sub ? `<div class="m">${sub}</div>` : ""}</div>`;
    const srcName = k => { const sid = (lay.stat_src || {})[k]; const s = sid && APP.data.sources[sid]; if (!s) return ""; return (s.url || "").startsWith("file:") ? "author's research note" : U.esc(s.publisher || s.title); };
    const st = k => { const tup = (lay.stats || {})[k]; const s = tup ? U.stat(tup) : null; return s ? `${U.asOf(s.as_of)} ${Panel.grade(s.conf)} ${Panel.method(s.method)} ${srcName(k)}` : ""; };
    const nodes = (APP.idx.byLayer[lay.id] || []);
    const top = nodes.filter(n => n.bn && n.bn.effective != null).sort((a, b) => b.bn.effective - a.bn.effective).slice(0, 6);
    const cats = t.categories ? Object.entries(t.categories) : [];
    /* Capacity fill is averaged from node utilizations, and the seed stores some of
       those as percentages and some as ratios, which yields figures like 8,350%.
       Read an impossible fill back through the mean utilization before showing it. */
    const fillRaw = t.fill_pct;
    const fillFixed = (fillRaw != null && fillRaw > 100.5 && t.utilization_mean != null) ? Fmt.pctOf(t.utilization_mean) : fillRaw;
    const fillNormalised = fillFixed != null && fillRaw != null && Math.abs(fillFixed - fillRaw) > 0.5;
    const fillSub = t.fill_source === "nodes"
      ? "average across companies that disclose it" + (fillNormalised ? " · normalised from mixed units" : "")
      : (st("fill_pct") || "curated layer figure");
    /* Concentration only means something against how much of the layer is tracked. */
    const cov = t.coverage_pct;
    const hhiSub = [
      t.top3_share_pct != null ? `top-3 ${Fmt.sharePct(t.top3_share_pct)}` : "",
      cov != null ? `${U.num(cov, 0)}% of the market tracked` : "",
    ].filter(Boolean).join(" · ");
    const hhiHelp = "Herfindahl index of the tightest product market in this layer. 10,000 means one tracked supplier, under 1,500 is unconcentrated. Shares above 100% are overlapping estimates in the seed.";
    const capSub = [
      t.demand != null ? `demand ${Fmt.qty(t.demand, t.unit)}` : "",
      cov != null ? `owner nodes covering ~${U.num(cov, 0)}% of the market` : "sum of owner nodes",
    ].filter(Boolean).join(" · ");
    /* evidence grade mix, so a reader can see how soft a layer is */
    const gm = t.grade_mix || {}; const grades = ["A", "B", "C", "D"];
    const gmTotal = grades.reduce((a, k) => a + (gm[k] || 0), 0);
    const quality = gmTotal ? `<div class="section"><h4>Evidence behind this layer</h4>
      <div class="gradebar">${grades.map(k => (gm[k] ? `<i class="g-${k}" style="width:${(gm[k] / gmTotal * 100).toFixed(1)}%" title="${U.esc(U.gradeName(k))} — ${gm[k]} figures"></i>` : "")).join("")}</div>
      <div class="gradebar-key">${grades.map(k => `<span>${Panel.grade(k)} ${gm[k] || 0}</span>`).join("")}<span class="n">${gmTotal} figures${t.n_est_only != null ? ` · ${t.n_est_only} of ${nodes.length} rest on our estimates only` : ""}</span></div></div>` : "";
    const finSection = f.n_listed
      ? `<div class="section"><h4>Valuation and growth of listed names</h4>${Widgets.finTiles(f)}</div>`
      : `<div class="section"><h4>Valuation and growth of listed names</h4><p class="note">No listed names in this layer — it is markets, products and private companies.</p></div>`;
    return `
      <div class="panel-drag-handle" aria-hidden="true"></div>
      <div class="panel-head"><i class="dot" style="background:${col}"></i><div><span class="eyebrow">Layer ${Math.round(lay.order)} · ${U.esc(SEGMENT_LABEL[seg] || lay.kind)}</span><h2>${U.esc(lay.name)}</h2></div><button class="close" aria-label="Close panel" data-close>×</button></div>
      <p class="note">${U.esc(lay.description || "")}</p>
      <div class="stats">
        ${tile("Bottleneck score", lay.score != null ? `${lay.score} of 5` : null, "our calculation", "How hard it is to get more of what this layer makes: 0 is plenty of slack, 5 is sold out with few suppliers. Weighted by market share across the layer's companies.")}
        ${tile("Capacity in use", fillFixed != null ? `${U.num(fillFixed, 0)}%` : null, fillSub)}
        ${tile("Supply gap", t.supply_gap_pct != null ? `${U.num(t.supply_gap_pct, 0)}% of demand` : null, st("supply_gap_pct"))}
        ${tile("Capacity growth", Fmt.growth(t.capacity_growth_pct_yr, "/yr"), st("capacity_growth_pct_yr") || "tracked owners")}
        ${tile("Demand growth", Fmt.growth(t.demand_growth_pct_yr, "/yr"), st("demand_growth_pct_yr") || "tracked demand")}
        ${tile(`Pipeline to ${t.pipeline_horizon || ""}`, Fmt.growth(t.pipeline_growth_pct_2y), "planned additions vs tracked capacity")}
        ${tile(Fmt.unitKind(t.unit) === "money" ? "Tracked market size" : "Tracked capacity", t.capacity_total != null ? Fmt.qty(t.capacity_total, t.unit) : null, capSub)}
        ${tile("Relief year", t.relief_year, "when pipeline meets demand")}
        ${tile("Supplier concentration", t.hhi != null ? `${U.num(t.hhi, 0)} HHI` : null, hhiSub, hhiHelp)}
        ${tile("Lead time", t.lead_time_weeks ? `${U.num(t.lead_time_weeks, 0)} weeks` : null, "weighted by capacity")}
      </div>
      <div class="section"><h4>Expansion versus demand</h4>${Widgets.growth(t.capacity_growth_pct_yr, t.demand_growth_pct_yr, col)}${lay.expansion_note ? `<p class="note">${U.esc(lay.expansion_note)}</p>` : ""}</div>
      ${finSection}
      ${quality}
      <div class="section"><h4>Risks (${(lay.risks || []).length})</h4>${Widgets.risks(lay.risks)}</div>
      ${(lay.watch || []).length ? `<div class="section"><h4>What to watch</h4><ul class="watch">${lay.watch.map(w => `<li>${U.esc(w)}</li>`).join("")}</ul></div>` : ""}
      ${Widgets.sparkRows(lay.id, col) ? `<div class="section"><h4>Series</h4>${Widgets.sparkRows(lay.id, col)}</div>` : ""}
      ${cats.length ? `<div class="section"><h4>Product markets</h4><div class="catlist">${cats.map(([c, s]) => `<div class="row"><span>${U.esc(c.replace(/_/g, " "))}</span><span class="n">HHI ${U.num(s.hhi, 0)} · top-3 ${Fmt.sharePct(s.top3_share_pct)}${s.n ? ` of ${s.n} tracked` : ""}${s.capacity_total ? ` · ${Fmt.qty(s.capacity_total, s.unit)}` : ""}</span></div>`).join("")}</div></div>` : ""}
      <div class="section"><h4>Tightest bottlenecks in this layer</h4><div class="chips">${top.map(n => `<button class="chip" data-go="${n.id}"><i style="background:${col}"></i>${U.esc(n.name)}<span class="n">${n.bn.effective}</span></button>`).join("") || "<span class='note'>none scored yet</span>"}</div></div>
      <div class="section"><h4>All companies and markets (${nodes.length})</h4><div class="chips">${nodes.map(n => `<button class="chip ${!(n.fin && n.fin.mcap) && !(n.cap && n.cap.cur) ? "est" : ""}" data-go="${n.id}">${U.esc(n.name)}</button>`).join("")}</div></div>`;
  },
  planned(n) {
    const cap = n.cap; const cur = cap.cur ? cap.cur[0] : 0; let cum = cur;
    const rows = [...cap.planned].sort((a, b) => a[0] - b[0]).map(p => { cum += p[1]; return { y: p[0], add: p[1], cum, st: p[2], conf: p[3] }; });
    const max = Math.max(cum, cur || 1);
    const seg = U.segment(U.layerOf(n.layer).kind);
    return `<div class="section"><h4>Planned buildout</h4><div class="planned">
      ${cur ? `<div class="row"><span class="yr">now</span><div class="bar-wrap"><i style="width:${(cur / max) * 100}%;background:var(--seg-${seg})"></i></div><span class="st">${Fmt.qty(cur, cap.unit)}</span></div>` : ""}
      ${rows.map(r => `<div class="row"><span class="yr">${r.y}</span><div class="bar-wrap"><i style="width:${(r.cum / max) * 100}%;background:var(--seg-${seg});opacity:.55"></i></div><span class="st">+${Fmt.qty(r.add, cap.unit)} → ${Fmt.qty(r.cum, cap.unit)} · ${r.st.replace(/_/g, " ")} ${Panel.grade(r.conf)}</span></div>`).join("")}
    </div></div>`;
  },
  evidence(n, ev) {
    const esc = U.esc;
    const gradeOrder = { A: 0, B: 1, C: 2, D: 3 };
    const sorted = [...(ev.stats || [])].sort((a, b) => ((gradeOrder[a.conf] ?? 4) - (gradeOrder[b.conf] ?? 4)) || (b.as_of || "").localeCompare(a.as_of || ""));
    const val = s => s.v == null ? '<span class="na" title="The source does not disclose this figure">not disclosed</span>'
      : Fmt.qty(s.v, s.unit) + (s.lo != null && s.hi != null ? ` <span class="range">(${Fmt.range(s.lo, s.hi, s.unit).replace("–", " to ")})</span>` : "");
    const stats = sorted.map(s => `<li class="${s.conf === "D" || s.method === "estimated" ? "est" : ""}">
      <div class="ev-top"><span class="ev-what">${esc(Panel.pathWord(s.path))}</span><span class="val">${val(s)}</span></div>
      <div class="src">${Panel.grade(s.conf)} ${Panel.method(s.method)} ${s.as_of ? `as of ${esc(Panel.date(s.as_of))} · ` : ""}${Panel.srcHtml(s.src)}${s.note ? `<span class="ev-note">${esc(s.note)}</span>` : ""}</div></li>`).join("");
    const claims = (ev.claims || []).map(c => `<li><div class="ev-claim">${esc(c.text)}</div><div class="src">${Panel.grade(c.conf)} ${c.date ? `${esc(Panel.date(c.date))} · ` : ""}${Panel.srcHtml(c.src)}</div></li>`).join("");
    const alts = (ev.alternatives || []).length ? `<h5>Alternatives</h5><ul class="ev">${ev.alternatives.map(a => `<li>${a.node_id && U.nodeOf(a.node_id) ? `<button class="p-link" data-go="${a.node_id}">${esc(a.name)}</button>` : esc(a.name)} <span class="src">${esc(String(a.maturity || "").replace(/_/g, " "))} · threat ${esc(a.threat)}${a.note ? `: ${esc(a.note)}` : ""}</span></li>`).join("")}</ul>` : "";
    const cust = (ev.customers || []).length ? `<h5>Main customers</h5><ul class="ev">${ev.customers.map(c => `<li><button class="p-link" data-go="${c.node_id}">${esc(U.nodeOf(c.node_id) ? U.nodeOf(c.node_id).name : c.node_id)}</button> <span class="src">${c.share ? U.fmtStat(c.share, "pct") + " of revenue" : ""}${c.term_years ? ` · ${c.term_years}-year term` : ""}${c.note ? `: ${esc(c.note)}` : ""}</span></li>`).join("")}</ul>` : "";
    const notes = ev.notes ? `<p class="note">${esc(ev.notes)}</p>` : "";
    const links = (ev.ir_urls || []).length ? `<p class="p-small">Investor relations: ${ev.ir_urls.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>`).join(" · ")}</p>` : "";
    const key = `<p class="ev-key">Every figure shows its source, date and a confidence grade: ${["A", "B", "C", "D"].map(Panel.grade).join(" ")}. Hover a grade for what it means.</p>`;
    const nS = (ev.stats || []).length, nC = (ev.claims || []).length;
    return `<h4>Evidence <span class="h-n">${nS} figure${nS === 1 ? "" : "s"}, ${nC} statement${nC === 1 ? "" : "s"}</span></h4>${key}
      ${stats ? `<ul class="ev">${stats}</ul>` : ""}${claims ? `<h5>What sources say</h5><ul class="ev claims">${claims}</ul>` : ""}${alts}${cust}${notes}${links}`;
  },
  bind(inner) {
    U.$$("[data-go]", inner).forEach(b => U.on(b, "click", () => { State.set({ node: b.getAttribute("data-go"), layer: null }); if (typeof MapView !== "undefined" && MapView.focusNode) MapView.focusNode(b.getAttribute("data-go")); }));
    U.$$("[data-layer]", inner).forEach(b => U.on(b, "click", () => State.set({ layer: b.getAttribute("data-layer"), node: null })));
    const c = U.$("[data-close]", inner); if (c) U.on(c, "click", Panel.close);
    /* keyboard close */
    /* (escape is handled globally in Boot.bind; we add it here too for robustness) */
    /* nav buttons: open in map/flows */
    U.$$("[data-nav]", inner).forEach(b => U.on(b, "click", () => {
      const target = b.getAttribute("data-nav");
      const nid = APP.state.node;
      if (target === "map" && nid) { State.set({ view: "map" }); if (typeof MapView !== "undefined" && MapView.focusNode) MapView.focusNode(nid); }
      else if (target === "flows") { State.set({ view: "flows" }); }
    }));
    /* phone bottom-sheet drag handle */
    const handle = U.$(".panel-drag-handle", inner);
    if (handle && window.innerWidth <= 720) {
      let startY = 0; let startH = 0; const panel = Panel.el();
      const onMove = (e) => {
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const delta = startY - clientY;
        const newH = Math.max(20, Math.min(95, startH + (delta / window.innerHeight) * 100));
        panel.style.height = newH + "%";
      };
      const onEnd = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onEnd);
        document.removeEventListener("touchmove", onMove);
        document.removeEventListener("touchend", onEnd);
        const h = parseFloat(panel.style.height);
        if (h < 25) Panel.close();
      };
      const onStart = (e) => {
        startY = e.touches ? e.touches[0].clientY : e.clientY;
        startH = (panel.offsetHeight / window.innerHeight) * 100;
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onEnd);
        document.addEventListener("touchmove", onMove, { passive: true });
        document.addEventListener("touchend", onEnd);
      };
      handle.addEventListener("mousedown", onStart);
      handle.addEventListener("touchstart", onStart, { passive: true });
    }
  },
};
/* Overview: the public landing view. Rendered into #view-overview.
   The stack reads top to bottom from the token buyers down to raw materials,
   the same orientation as the map (materials at the bottom, tokens at the top).
   Live market data (35_live.js) feeds the hero market cap and "Today in the chain";
   without live.json those parts fall back to the build's figures or stay hidden. */
const Overview = {
  MONTHS: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  /* companies below this live market cap are left out of the top-movers list, so a small cap's swing does not lead the page */
  MOVER_MIN_BN: 10,
  SIGNALS: [["sox", "Chip stocks (SOX)"], ["us10y", "US 10-year yield"], ["copper", "Copper"], ["brent", "Brent oil"], ["henryhub", "US natural gas"], ["vix", "Volatility (VIX)"]],

  live() { return typeof Live !== "undefined" && Live.ready; },
  date(d) {
    const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${+m[3]} ${Overview.MONTHS[+m[2] - 1]} ${m[1]}` : (d || "");
  },
  /* USD bn to a short label: $5.30tn, $212bn, $8.1bn */
  usd(bn) {
    if (bn == null) return "";
    if (bn >= 1000) return `$${U.num(bn / 1000, bn >= 10000 ? 1 : 2)}tn`;
    if (bn >= 10) return `$${U.num(bn, 0)}bn`;
    return `$${U.num(bn, 1)}bn`;
  },
  /* plain word for a 0 to 5 bottleneck score (display banding, not a data field) */
  word(s) { return s == null ? "not scored" : s >= 4 ? "tight" : s >= 3 ? "firm" : "loose"; },
  wordHelp: {
    tight: "Score 4 or above: capacity is full, lead times are long or suppliers are few. New demand waits.",
    firm: "Score 3 to 3.9: running hot, but some slack or alternatives exist.",
    loose: "Score under 3: capacity or alternatives are available.",
    "not scored": "Too few companies in this layer disclose utilisation, lead times or market shares to score it with confidence. See the Bottlenecks view for what is missing.",
  },
  SEV: { high: 0, med: 1, low: 2 },
  SEV_WORD: { high: "High risk", med: "Medium risk", low: "Low risk" },
  SHORT: { minerals_gases: "Minerals and gases", engineered_materials: "Engineered materials", litho_subsystems: "Litho subsystems", semicap: "Chip-making tools", wafer_fab: "Wafer fabs", memory: "Memory", packaging_substrates: "Packaging", accelerators: "Accelerators", networking_optics: "Networking and optics", servers_cooling: "Servers and cooling", dc_equipment_construction: "DC electrical gear", power_grid: "Power and grid", data_centers: "Data centres", compute_providers: "Compute providers", frontier_labs: "Frontier labs", inference_distribution: "Inference", token_consumers: "Token consumers" },
  short(l) { return Overview.SHORT[l.id] || l.name.replace(/\s*\([^)]*\)/, "").replace(/,.*$/, ""); },
  /* drop parenthetical qualifiers on chips; the full name is in the tooltip and panel */
  shortName(n) { const s = n.name.replace(/\s*\([^)]*\)\s*$/, "").trim(); return s.length > 2 ? s : n.name; },

  /* a node's headline value: listed market cap (live once 35_live.js has run), else private valuation */
  value(n) {
    const f = n.fin || {};
    if (f.mcap) return { v: f.mcap[0], as_of: f.mcap[1], conf: f.mcap[2], what: f.mcap[3] === "live" ? "live market cap" : "market cap" };
    if (f.val) return { v: f.val[0], as_of: f.val[1], conf: f.val[2], what: "last private valuation" };
    return null;
  },
  topNodes(layId, k) {
    const all = (APP.idx.byLayer[layId] || []).slice();
    const rank = n => { const v = Overview.value(n); return v ? v.v : -1; };
    const cos = all.filter(n => n.type === "company").sort((a, b) => (rank(b) - rank(a)) || ((b.size || 0) - (a.size || 0)));
    const rest = all.filter(n => n.type !== "company").sort((a, b) => (b.size || 0) - (a.size || 0));
    return cos.concat(rest).slice(0, k);
  },
  worstRisk(lay) {
    const r = (lay.risks || []).slice().sort((a, b) => (Overview.SEV[a.severity] ?? 3) - (Overview.SEV[b.severity] ?? 3));
    return r[0] || null;
  },

  stats(layers) {
    const d = APP.data, m = d.meta;
    /* listed market cap, de-duplicated by ticker (a few companies sit in two layers) */
    const seen = new Set(); let mcap = 0, nListed = 0, asOf = "";
    for (const n of d.nodes) {
      const t = n.fin && n.fin.mcap; if (!t || t[0] == null) continue;
      const key = n.tk ? `${n.tk}:${n.ex || ""}` : n.id; if (seen.has(key)) continue;
      seen.add(key); mcap += t[0]; nListed++; if (t[1] > asOf) asOf = t[1];
    }
    const scored = layers.filter(l => l.score != null).sort((a, b) => b.score - a.score);
    const countries = new Set(d.nodes.map(n => n.hq).filter(Boolean)).size;
    return { nodes: m.node_count, edges: m.edge_count, layers: layers.length, mcap, nListed, asOf, tight: scored[0], nScored: scored.length, countries };
  },

  subscribe() {
    if (Overview._sub || typeof Live === "undefined" || !Live.on) return;
    Overview._sub = true;
    Live.on((d, prev) => requestAnimationFrame(() => {
      if (APP.state.view !== "overview") return;
      const el = U.$("#view-overview"), y = el.scrollTop;
      Overview.render(); el.scrollTop = y;
      if (prev && Live.flash) Live.flash(el);
    }));
  },

  render() {
    Overview.subscribe();
    const el = U.$("#view-overview");
    const d = APP.data, m = d.meta, esc = U.esc;
    const layers = d.layers.filter(l => l.kind !== "capital").sort((a, b) => a.order - b.order);
    const capital = d.layers.find(l => l.kind === "capital");
    const st = Overview.stats(layers);
    const live = Overview.live();
    const top = layers.length ? layers[layers.length - 1].name.toLowerCase() : "", bottom = layers.length ? layers[0].name.toLowerCase() : "";

    const layerToday = {};
    if (live) for (const l of layers) layerToday[l.id] = Live.layerToday(l.id);

    const rows = []; let prevSeg = null;
    for (const lay of layers.slice().reverse()) {
      const seg = U.segment(lay.kind);
      if (seg !== prevSeg) { rows.push(`<li class="ov-seg" style="--seg:var(--seg-${seg})">${esc(SEGMENT_LABEL[seg] || seg)}</li>`); prevSeg = seg; }
      rows.push(Overview.row(lay, seg, layerToday[lay.id]));
    }

    const tabVisible = v => { const t = U.$(`#tab-${v}`); return t && !t.hidden; };
    const tabLabel = (v, fb) => { const t = U.$(`#tab-${v}`); return t ? t.textContent.trim() : fb; };
    const cards = [
      ["map", "Map", "Who supplies whom? Every company and market on one zoomable chart, with the links between them."],
      ["bottlenecks", "Bottlenecks", "Which layers are tightest, why, and what are their listed companies valued at?"],
      ["flows", "Flows", "Where do the money and the megawatts go as they move down the chain?"],
      ["demand", "Demand 2×2", "Which token buyers keep paying for frontier AI, and which could stop?"],
      ["country", "Countries", "Where does the chain physically sit, and how exposed is each country?"],
      ["rates", "Cost of capital", "Is the buildout's borrowing showing up in bond yields and credit spreads?"],
      ["findings", "Findings", "What does the data say? Short written reports, every figure linked to its source."],
    ].filter(([v]) => tabVisible(v)).map(([v, fb, q]) => `<button class="ov-card" data-view="${v}"><span class="ov-card-t">${esc(tabLabel(v, fb))} <span class="ov-card-arrow" aria-hidden="true">→</span></span><span class="ov-card-q">${esc(q)}</span></button>`).join("");

    el.innerHTML = `<div class="ov-wrap">
      <header class="ov-hero">
        <div class="ov-hero-grid"><div class="ov-hero-text">
          <p class="ov-kicker">An open map of the AI buildout</p>
          <h1 class="ov-title">The AI supply chain, from rocks to tokens</h1>
          <p class="ov-lede">Every AI answer rests on a chain of ${st.layers} industries: mines and gas plants, lithography optics, chip fabs and memory, power grids, data centres, clouds and labs. This explorer maps the ${U.num(st.nodes, 0)} companies and markets in that chain, scores how tight each layer is, and shows who supplies whom. Click a layer below to open it on the map, or a company to see its numbers and sources.</p>
          <p class="ov-byline">By GJI <span class="ov-dot">·</span> data as of <time datetime="${esc(m.today)}">${esc(Overview.date(m.today))}</time></p>
        </div>${Overview.glance(layers)}</div>
        ${Overview.statsHtml(st)}
      </header>

      ${live ? Overview.today(layers, layerToday) : ""}

      <section class="ov-sec" aria-labelledby="ov-stack-h">
        <div class="ov-sec-head">
          <h2 id="ov-stack-h">The stack</h2>
          <p>${st.layers} layers, ${esc(top)} at the top and ${esc(bottom)} at the bottom, the same way up as the map. The bar is the bottleneck score: 0 means plenty of slack, 5 means sold out with few suppliers and years to add capacity.</p>
        </div>
        <ol class="ov-stack">${rows.join("")}</ol>
        ${capital ? `<p class="ov-capital">Beside the stack sits a <button class="ov-link" data-layer="${esc(capital.id)}">${esc(capital.name.toLowerCase())}</button> layer: ${(APP.idx.byLayer[capital.id] || []).length} sovereign funds, private-credit lenders, banks and vendor-finance schemes that pay for the buildout.</p>` : ""}
      </section>

      <section class="ov-sec" aria-labelledby="ov-explore-h">
        <div class="ov-sec-head"><h2 id="ov-explore-h">Explore</h2><p>Seven ways into the same data. Each answers one question.</p></div>
        <div class="ov-cards">${cards}</div>
      </section>

      <footer class="ov-foot">
        <div>
          <h3>How the data is built</h3>
          <p>Public sources only: company filings, statistics offices, company statements, trade press and market data. Every number carries a date, a source and a confidence grade:</p>
          <ul class="ov-grades">
            <li>${U.gradeChip("A")} filing or official data</li>
            <li>${U.gradeChip("B")} company statement</li>
            <li>${U.gradeChip("C")} press, analyst or market data</li>
            <li>${U.gradeChip("D")} our estimate</li>
          </ul>
          <p>Bottleneck scores, the tight, firm and loose labels, and totals such as the market-cap sum are our own calculations from those sourced inputs. Live prices are Yahoo Finance quotes (grade C), some delayed by 15 to 20 minutes.</p>
        </div>
        <div class="ov-foot-side">
          <p><b>Not investment advice.</b> This is a research map, not a recommendation to buy or sell anything.</p>
          <p class="ov-build">Last build <time datetime="${esc(m.built_at || m.today)}">${esc(Overview.date(m.built_at || m.today))}</time> · ${U.num(st.nodes, 0)} nodes · ${U.num(st.edges, 0)} links</p>
        </div>
      </footer>
    </div>`;
    Overview.bind(el);
  },

  statsHtml(st) {
    const esc = U.esc, live = Overview.live();
    let capStat;
    if (live && Live.data.idx) {
      const idx = Live.data.idx, hist = Live.history();
      capStat = `<div class="ov-stat ov-stat-live" title="${esc(`Combined market cap of the ${Live.data.n} listed companies in the chain, each counted once, from Yahoo Finance quotes (grade C, some delayed 15 to 20 minutes). The change is since each market's previous close. Updates about every 10 minutes on weekdays.`)}">
        <div class="ov-stat-l ov-live-tag">${Live.dot()} Live <span class="live-ago">${esc(Live.ago())}</span></div>
        <div class="ov-stat-v"><span class="live-num">${Overview.usd(idx.m)}</span> ${Live.chg(idx.c)}</div>
        <div class="ov-stat-l">listed market cap across ${Live.data.n} companies</div>
        ${hist.length >= 2 ? `<div class="ov-stat-spark">${Live.spark(hist, 180, 28)}</div>` : ""}
      </div>`;
    } else {
      capStat = `<div class="ov-stat ov-stat-live" title="${esc(`Sum of market caps for ${st.nListed} listed companies, each counted once. Market data (grade C) as of ${Overview.date(st.asOf)}; the sum is our derivation.`)}"><div class="ov-stat-l ov-live-tag">As of ${esc(Overview.date(st.asOf))}</div><div class="ov-stat-v">${Overview.usd(st.mcap)}</div><div class="ov-stat-l">listed market cap across ${st.nListed} companies</div></div>`;
    }
    const stat = (v, l, help) => `<div class="ov-stat" title="${esc(help)}"><div class="ov-stat-v">${v}</div><div class="ov-stat-l">${l}</div></div>`;
    return `<div class="ov-stats">${capStat}
      ${stat(U.num(st.nodes, 0), "companies and markets mapped", `${st.nodes} nodes: listed and private companies, plus product markets and commodity segments, headquartered in ${st.countries} countries, linked by ${st.edges} sourced relationships.`)}
      ${stat(U.num(st.layers, 0), "layers, from minerals to token buyers", `${st.layers} layers in the AI chain, plus a capital layer of funders and lenders.`)}
      ${st.tight ? stat(`${st.tight.score.toFixed(1)}<span class="ov-of"> / 5</span>`, `tightest layer: ${esc(st.tight.name.toLowerCase())}`, `Highest bottleneck score of the ${st.nScored} scored layers. The 0 to 5 score combines utilisation, lead times, backlog, supplier concentration, substitutes and years to new capacity.`) : ""}
    </div>`;
  },

  /* hero figure: the whole stack at a glance, one bar per layer */
  glance(layers) {
    const esc = U.esc;
    const rows = layers.slice().reverse().map(l => {
      const s = l.score, w = Overview.word(s), seg = U.segment(l.kind);
      const tip = s != null ? `${l.name}: bottleneck score ${s} of 5, ${w}` : `${l.name}: not scored yet`;
      return `<button class="ov-g-row w-${w.replace(" ", "-")}" data-jump="${esc(l.id)}" title="${esc(tip)}" style="--seg:var(--seg-${seg})"><i class="ov-g-dot"></i><span class="ov-g-name">${esc(Overview.short(l))}</span><span class="ov-g-bar"><i style="width:${s != null ? s / 5 * 100 : 0}%"></i></span><span class="ov-g-v">${s != null ? s.toFixed(1) : "–"}</span></button>`;
    }).join("");
    return `<figure class="ov-glance"><figcaption>How tight is each layer? <span>Bottleneck score, 0 to 5</span></figcaption>${rows}</figure>`;
  },

  /* "Today in the chain": layers by today's move, top movers, market signals */
  today(layers, layerToday) {
    const esc = U.esc;
    const ranked = layers.map(l => ({ l, t: layerToday[l.id] })).filter(x => x.t).sort((a, b) => b.t.c - a.t.c);
    const maxAbs = Math.max(0.5, ...ranked.map(x => Math.abs(x.t.c)));
    const layerRows = ranked.map(({ l, t }) => {
      const w = Math.abs(t.c) / maxAbs * 50, up = t.c >= 0;
      return `<button class="ov-t-row" data-layer="${esc(l.id)}" title="${esc(`${l.name}: ${t.n} listed compan${t.n === 1 ? "y" : "ies"}, ${Overview.usd(t.m)} combined, cap-weighted change today`)}" style="--seg:var(--seg-${U.segment(l.kind)})"><i class="ov-g-dot"></i><span class="ov-t-name">${esc(Overview.short(l))}</span><span class="ov-t-bar"><i class="${up ? "up" : "down"}" style="${up ? "left:50%" : `left:${50 - w}%`};width:${w}%"></i></span><span class="ov-t-v">${Live.chg(t.c)}</span></button>`;
    }).join("");

    /* movers: one entry per symbol, chain layers only, large companies only */
    const seen = new Set(), movers = [];
    for (const n of APP.data.nodes) {
      const q = Live.node(n.id); const lay = U.layerOf(n.layer);
      if (!q || q.c == null || !lay || lay.kind === "capital" || seen.has(q.sym) || q.m < Overview.MOVER_MIN_BN) continue;
      seen.add(q.sym); movers.push({ n, q, lay });
    }
    movers.sort((a, b) => b.q.c - a.q.c);
    const gain = movers.filter(x => x.q.c > 0).slice(0, 3), lose = movers.filter(x => x.q.c < 0).slice(-3).reverse();
    const mv = x => `<li><button class="ov-mv" data-node="${esc(x.n.id)}" title="${esc(`${x.n.name} (${x.q.sym}): live market cap ${Overview.usd(x.q.m)}, change since previous close`)}"><span class="ov-mv-n">${esc(Overview.shortName(x.n))}<span class="ov-mv-l">${esc(Overview.short(x.lay))}</span></span><span class="ov-mv-c">${Live.chg(x.q.c)}</span></button></li>`;
    const moverCol = (title, list) => `<div class="ov-mvcol"><h4>${title}</h4>${list.length ? `<ul>${list.map(mv).join("")}</ul>` : `<p class="ov-muted">None today</p>`}</div>`;

    const sig = Overview.SIGNALS.map(([k, label]) => {
      const mk = Live.market(k); if (!mk || mk.v == null) return "";
      const h = Live.history(k);
      return `<div class="ov-sig" title="${esc(`${mk.label}. Change since the previous close${mk.kind === "yield" ? ", in basis points (0.01 percentage points)" : ""}. Market data, grade C.`)}"><span class="ov-sig-l">${esc(label)}</span><span class="ov-sig-v live-num">${Live.marketValue(mk)}</span>${Live.marketChg(mk)}${h.length >= 2 ? Live.spark(h, 64, 18) : ""}</div>`;
    }).join("");

    return `<section class="ov-sec ov-today" aria-labelledby="ov-today-h">
      <div class="ov-sec-head ov-today-head">
        <h2 id="ov-today-h">Today in the chain</h2>
        <p>${Live.dot()} Live market data, updated <span class="live-ago">${esc(Live.ago())}</span>. Moves are since each market's previous close.</p>
      </div>
      <div class="ov-today-grid">
        <div class="ov-today-layers"><h4>Layers by today's move <span>cap-weighted, listed companies</span></h4>${layerRows}</div>
        <div class="ov-today-movers">${moverCol("Biggest gainers", gain)}${moverCol("Biggest fallers", lose)}<p class="ov-muted ov-mv-note">Companies worth more than $${Overview.MOVER_MIN_BN}bn.</p></div>
      </div>
      ${sig ? `<div class="ov-sigs">${sig}</div>` : ""}
    </section>`;
  },

  row(lay, seg, t) {
    const esc = U.esc;
    const s = lay.score, w = Overview.word(s);
    const conf = typeof Dashboard !== "undefined" && Dashboard.layerConf ? Dashboard.layerConf(lay.id) : null;
    const scoreTip = s != null
      ? `Bottleneck score ${s} of 5 (${w}). ${Overview.wordHelp[w]}${conf ? ` Based on ${conf.n} of ${conf.of} companies in the layer, mean data confidence ${Math.round(conf.mean * 100)}%.` : ""}`
      : Overview.wordHelp["not scored"];
    const pct = s != null ? Math.max(0, Math.min(100, s / 5 * 100)) : 0;
    const nNodes = (APP.idx.byLayer[lay.id] || []).length;
    const chips = Overview.topNodes(lay.id, 3).map(n => {
      const v = Overview.value(n);
      const tip = v ? `${n.name}: ${v.what} ${Overview.usd(v.v)}, as of ${Overview.date(v.as_of)}, grade ${v.conf} (${U.gradeName(v.conf).replace(/^[A-D]: /, "")})` : `${n.name}: ${n.type === "company" ? "no market value recorded" : n.type}`;
      return `<button class="ov-chip" data-node="${esc(n.id)}" title="${esc(tip)}">${esc(Overview.shortName(n))}</button>`;
    }).join("");
    const r = Overview.worstRisk(lay);
    const risk = r ? `<p class="ov-risk sev-${esc(r.severity)}" title="${esc(`${Overview.SEV_WORD[r.severity] || "Risk"}: ${r.text}. Source grade ${r.conf}: ${U.gradeName(r.conf).replace(/^[A-D]: /, "")}.`)}">${esc(r.text)}</p>` : "";
    const today = t ? `<span class="ov-l-today" title="${esc(`${t.n} listed compan${t.n === 1 ? "y" : "ies"} in this layer, ${Overview.usd(t.m)} combined; cap-weighted change since the previous close`)}">${Live.chg(t.c)}</span>` : `<span class="ov-l-today ov-muted" title="No listed companies with live quotes in this layer">–</span>`;
    return `<li class="ov-layer" data-layer="${esc(lay.id)}" style="--seg:var(--seg-${seg})">
      <div class="ov-l-id">
        <button class="ov-l-name" data-layer="${esc(lay.id)}" title="Open ${esc(lay.name)} on the map">${esc(lay.name)}</button>
        <p class="ov-l-desc">${esc(lay.description || "")}</p>
        ${risk}
      </div>
      <div class="ov-score w-${w.replace(" ", "-")}" title="${esc(scoreTip)}">
        <div class="ov-score-top"><span class="ov-score-v">${s != null ? s.toFixed(1) : "–"}</span><span class="ov-score-w">${w}</span></div>
        <div class="ov-bar"><i style="width:${pct}%"></i></div>
      </div>
      <div class="ov-chips">${chips}${nNodes > 3 ? `<button class="ov-more" data-layer="${esc(lay.id)}" title="Open all ${nNodes} on the map">+${nNodes - 3}</button>` : ""}</div>
      ${Overview.live() ? today : ""}
    </li>`;
  },

  openLayer(id) {
    State.set({ view: "map", layer: id, node: null });
    if (typeof MapView !== "undefined" && MapView.jumpToLayer) requestAnimationFrame(() => MapView.jumpToLayer(id));
  },
  openNode(id) {
    State.set({ view: "map", node: id, layer: null });
    if (typeof MapView !== "undefined" && MapView.focusNode) requestAnimationFrame(() => MapView.focusNode(id));
  },
  bind(el) {
    U.$$("[data-node]", el).forEach(b => U.on(b, "click", e => { e.stopPropagation(); Overview.openNode(b.getAttribute("data-node")); }));
    U.$$("button[data-layer]", el).forEach(b => U.on(b, "click", e => { e.stopPropagation(); Overview.openLayer(b.getAttribute("data-layer")); }));
    /* the whole row is a click target for pointer users; keyboard users get the name button */
    U.$$("li.ov-layer", el).forEach(li => U.on(li, "click", e => { if (e.target.closest("button") || (window.getSelection && String(window.getSelection()))) return; Overview.openLayer(li.getAttribute("data-layer")); }));
    U.$$("[data-jump]", el).forEach(b => U.on(b, "click", () => {
      const r = U.$(`li.ov-layer[data-layer="${b.getAttribute("data-jump")}"]`, el); if (!r) return;
      r.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      r.classList.remove("ov-flash"); void r.offsetWidth; r.classList.add("ov-flash");
    }));
    U.$$(".ov-card", el).forEach(b => U.on(b, "click", () => { State.set({ view: b.getAttribute("data-view"), node: null, layer: null }); const v = U.$(`#view-${b.getAttribute("data-view")}`); if (v) v.scrollTop = 0; }));
  },
};
/* Layered map on Canvas. One horizontal band per layer, raw materials at the
   bottom and token buyers at the top, capital providers in a column on the right.
   The layer column on the left is DOM (real text, tooltips, buttons) pinned in
   screen space; nodes, edges and labels are painted on the canvas. Labels and
   node radii are drawn in screen pixels, so they stay readable at any zoom.

   Public API used elsewhere: init, resize, request, fit, focusNode,
   focusLayer (alias jumpToLayer), legend. */
const MapView = {
  /* ---- state ---- */
  canvas: null, ctx: null, dpr: 1, w: 0, h: 0,
  layout: null, tf: { k: 1, x: 0, y: 0 }, hover: null, hoverBand: null, needsDraw: false,
  /* world geometry */
  CELL_W: 96, CELL_H: 60, BAND_TOP: 14, BAND_BOT: 10, MIN_BAND: 70, RAIL_W: 140,
  /* screen geometry, set in resize() */
  GUTTER: 236, HEAD_H: 64, BOTTOM_PAD: 46,
  colourBy: "segment",            /* "segment", "bottleneck", "stale" or "today" */
  kbFocus: null,
  _chainCache: null, _chainSel: null,
  _ptrs: new Map(), _drag: null, _pinch: null, _anim: null,
  _seenLayer: null, _seenNode: null, _cardCache: {},

  /* ==================================================================
     Lifecycle
     ================================================================== */
  init() {
    MapView.canvas = U.$("#map-canvas");
    MapView.ctx = MapView.canvas.getContext("2d");
    MapView.canvas.setAttribute("tabindex", "0");
    const wrap = U.$("#map-wrap");
    new ResizeObserver(() => MapView.resize()).observe(wrap);

    /* headline strip: what this is, in one sentence, and the map's own controls */
    const head = document.createElement("div");
    head.className = "map-head";
    head.innerHTML =
      '<div class="mh-text"><h2 class="mh-title">The AI supply chain, layer by layer</h2>' +
      '<p class="mh-sub">Raw materials at the bottom, the companies that buy AI at the top. Each dot is a company or market; hover or tap one for details.</p></div>' +
      '<div class="mh-tools"></div>';
    wrap.appendChild(head); MapView._head = head;
    const tools = U.$(".mh-tools", head);
    new ResizeObserver(function () {
      var hh = Math.round(head.getBoundingClientRect().height) + 4;
      if (hh > 4 && Math.abs(hh - MapView.HEAD_H) > 1) { MapView.HEAD_H = hh; MapView.request(); }
    }).observe(head);

    /* jump-to-layer menu */
    const ln = document.createElement("div");
    ln.className = "map-layer-nav";
    ln.innerHTML = '<button class="ln-btn" type="button" aria-haspopup="true" aria-expanded="false" title="Jump to a layer">Layers</button><div class="ln-list" hidden role="menu"></div>';
    tools.appendChild(ln); MapView._layerNav = ln;
    MapView._layerList = U.$(".ln-list", ln);
    U.on(U.$(".ln-btn", ln), "click", function () {
      const l = MapView._layerList; l.hidden = !l.hidden;
      this.setAttribute("aria-expanded", String(!l.hidden));
      if (!l.hidden) MapView._buildLayerList();
    });
    U.on(document, "click", function (e) {
      if (!e.target.closest(".map-layer-nav")) { MapView._layerList.hidden = true; const b = U.$(".ln-btn", MapView._layerNav); if (b) b.setAttribute("aria-expanded", "false"); }
    });

    /* colour-by toggle */
    const ct = document.createElement("div");
    ct.className = "map-colour-toggle";
    ct.innerHTML = '<label for="map-colour-sel">Colour by</label><select id="map-colour-sel" title="What the dot colours show"><option value="segment">Part of the chain</option><option value="bottleneck">Bottleneck score</option><option value="stale">Data freshness</option><option value="today">Today\'s share move</option></select>';
    tools.appendChild(ct);
    U.on(U.$("#map-colour-sel"), "change", function () { MapView.colourBy = this.value; MapView.legend(); MapView.request(); });

    /* the how-to lives with the other controls, clear of the layer column */
    const howto = U.$("#howto");
    if (howto) {
      tools.appendChild(howto);
      const s = U.$("summary", howto); if (s) s.textContent = "How to read";
      const p = U.$("p", howto);
      if (p) p.innerHTML =
        "<b>Bands are layers.</b> Each horizontal band is one industry in the chain: minerals and gases at the bottom, then tools, chips, power and data centres, clouds and labs, and the companies that buy AI tokens at the top. Capital providers sit in the column on the right.<br><br>" +
        "<b>Dots are companies or markets.</b> Bigger dots are worth more (market value, or market share for products and raw materials). A dashed outline means every figure for it is our estimate rather than a published number.<br><br>" +
        "<b>Lines are relationships.</b> They appear when you hover or select a dot: solid for supply, dashed for finance, leases and ownership, dotted for buying AI tokens. Selecting a dot isolates its supply chain three steps up and down.<br><br>" +
        "<b>The left column</b> summarises each layer in plain numbers. Click a layer for its full panel. Drag to pan, scroll or pinch to zoom, press fit to see the whole stack.";
    }

    /* layer column (DOM, screen space) */
    const gut = document.createElement("div");
    gut.className = "map-gutter";
    gut.setAttribute("role", "list");
    gut.setAttribute("aria-label", "Layers of the chain");
    wrap.appendChild(gut); MapView._gutter = gut;
    U.on(gut, "wheel", MapView.onWheel, { passive: false });
    U.on(gut, "pointerdown", MapView.onDown);

    /* rich hover card */
    const hc = document.createElement("div");
    hc.className = "map-hover-card"; hc.hidden = true;
    hc.setAttribute("role", "tooltip");
    wrap.appendChild(hc); MapView._hoverCard = hc;

    /* chain legend, shown while a node is selected */
    const cl = document.createElement("div");
    cl.className = "map-chain-legend"; cl.hidden = true;
    wrap.appendChild(cl); MapView._chainLegend = cl;

    /* keyboard instructions, announced when the canvas takes focus */
    const kb = document.createElement("p");
    kb.className = "visually-hidden"; kb.id = "map-kb-help";
    kb.textContent = "Arrow keys move between companies, up and down move between layers, Home and End jump to the top and bottom layer, plus and minus zoom, Enter opens the detail panel, Escape closes it.";
    wrap.appendChild(kb);
    MapView.canvas.setAttribute("aria-describedby", "map-kb-help");
    MapView.canvas.setAttribute("role", "application");

    MapView.resize(true);

    /* pointer: mouse, pen and touch, including two-finger pinch */
    const c = MapView.canvas;
    U.on(c, "pointerdown", MapView.onDown);
    U.on(c, "pointermove", MapView.onHover);
    U.on(c, "pointerleave", function () { if (MapView._drag) return; MapView.hover = null; MapView.hoverBand = null; MapView.tip(null); MapView.request(); });
    U.on(window, "pointermove", MapView.onMove);
    U.on(window, "pointerup", MapView.onUp);
    U.on(window, "pointercancel", MapView.onUp);
    U.on(c, "wheel", MapView.onWheel, { passive: false });
    U.on(c, "dblclick", function (e) { const r = c.getBoundingClientRect(); MapView.zoomBy(1.6, e.clientX - r.left, e.clientY - r.top, true); });

    U.on(U.$("#zoom-in"), "click", function () { MapView.zoomBy(1.4, null, null, true); });
    U.on(U.$("#zoom-out"), "click", function () { MapView.zoomBy(1 / 1.4, null, null, true); });
    U.on(U.$("#zoom-fit"), "click", function () { MapView.fit(true); });
    U.$("#zoom-fit").title = "Show the whole stack";
    U.$("#zoom-in").title = "Zoom in"; U.$("#zoom-out").title = "Zoom out";

    U.on(c, "keydown", MapView.onKeyDown);
    MapView.legend();
    if (typeof Live !== "undefined") Live.on(function () {
      if (MapView._gutter && MapView._gutter._cards) MapView._gutter._cards.forEach(function (el) { el._key = null; });
      if (MapView.colourBy === "today") MapView.legend();
      if (APP.state.view === "map") MapView.request();
    });
    Theme.watch && Theme.watch(function () { MapView._liveCols = null; });
  },

  resize(force) {
    const r = U.$("#map-wrap").getBoundingClientRect();
    const w = Math.max(200, r.width), h = Math.max(200, r.height);
    const sized = force || Math.abs(w - MapView.w) > 1 || Math.abs(h - MapView.h) > 1 || !MapView.layout;
    if (sized) {
      MapView.dpr = window.devicePixelRatio || 1;
      MapView.w = w; MapView.h = h;
      MapView.canvas.width = Math.round(w * MapView.dpr);
      MapView.canvas.height = Math.round(h * MapView.dpr);
      MapView.canvas.style.width = w + "px"; MapView.canvas.style.height = h + "px";
      const narrow = w < 640;
      MapView.GUTTER = narrow ? 96 : 236;
      MapView.HEAD_H = MapView._head ? Math.round(MapView._head.getBoundingClientRect().height) + 4 : (narrow ? 84 : 64);
      MapView.BOTTOM_PAD = narrow ? 40 : 46;
      MapView.computeLayout();
      MapView.fit(false);
      MapView._seenLayer = null; MapView._seenNode = null;   /* re-apply focus after a refit */
    }
    MapView.syncFocus(!sized);
    MapView.request();
  },

  /* screen area that is free for the canvas content */
  avail(noSheet) {
    const panelW = MapView._panelOpen() && MapView.w > 720 ? Math.min(MapView.w * 0.6, (U.$("#panel").getBoundingClientRect().width || 380)) : 0;
    const sheetH = !noSheet && MapView._panelOpen() && MapView.w <= 720 ? Math.round((U.$("#panel").getBoundingClientRect().height || MapView.h * 0.6)) : 0;
    var x0 = MapView.GUTTER + 8, x1 = MapView.w - panelW - (MapView.w < 640 ? 8 : 56);
    var y0 = MapView.HEAD_H + 4, y1 = Math.max(y0 + 80, MapView.h - Math.max(MapView.BOTTOM_PAD, sheetH + 8));
    return { x0: x0, x1: x1, y0: y0, y1: y1, w: x1 - x0, h: y1 - y0, panelW: panelW, sheetH: sheetH };
  },
  _panelOpen() { const p = U.$("#panel"); return !!(p && !p.hidden); },

  /* Pick the column count that lets the whole stack fit the screen at the largest
     zoom, so the opening view shows every layer at once. */
  computeLayout() {
    const g = APP.data;
    const layers = [...g.layers].filter(function (l) { return l.kind !== "capital"; }).sort(function (a, b) { return b.order - a.order; });
    const rail = g.layers.filter(function (l) { return l.kind === "capital"; });
    const counts = layers.map(function (l) { return (APP.idx.byLayer[l.id] || []).length; });
    const aw = Math.max(120, MapView.w - MapView.GUTTER - 16), ah = Math.max(120, MapView.h - MapView.HEAD_H - MapView.BOTTOM_PAD - 8);
    const railW = rail.length ? MapView.RAIL_W : 0;
    const bandH = function (n, cols) { return Math.max(MapView.MIN_BAND, MapView.BAND_TOP + MapView.BAND_BOT + Math.max(1, Math.ceil(n / cols)) * MapView.CELL_H); };
    var best = null;
    for (var c = 4; c <= 30; c++) {
      var wh = 0; for (var i = 0; i < counts.length; i++) wh += bandH(counts[i], c);
      var ww = c * MapView.CELL_W + railW;
      var k = Math.min(aw / ww, ah / wh);
      if (!best || k > best.k + 1e-6) best = { k: k, cols: c };
    }
    const cols = best.cols, areaW = cols * MapView.CELL_W, maxCell = MapView.CELL_W * 2.2;
    var pos = {}, bands = [], y = 0;
    for (var li = 0; li < layers.length; li++) {
      var lay = layers[li];
      var nodes = APP.idx.byLayer[lay.id] || [];
      var cats = lay.categories.length ? lay.categories : [...new Set(nodes.map(function (n) { return n.cat || "_"; }))];
      var ordered = [];
      for (var ci = 0; ci < cats.length; ci++) for (var ni = 0; ni < nodes.length; ni++) if ((nodes[ni].cat || "_") === cats[ci]) ordered.push(nodes[ni]);
      for (ni = 0; ni < nodes.length; ni++) if (!ordered.includes(nodes[ni])) ordered.push(nodes[ni]);
      var rows = Math.max(1, Math.ceil(ordered.length / cols));
      var perRow = Math.min(cols, Math.max(1, ordered.length));
      var cellW = Math.min(maxCell, areaW / perRow);
      var h = bandH(ordered.length, cols);
      var rowsY0 = y + MapView.BAND_TOP + (h - MapView.BAND_TOP - MapView.BAND_BOT - rows * MapView.CELL_H) / 2;
      var nodeIds = [], x0 = Infinity, x1 = -Infinity;
      for (var oi = 0; oi < ordered.length; oi++) {
        var n = ordered[oi]; nodeIds.push(n.id);
        var row = Math.floor(oi / cols), col = oi % cols;
        var inRow = Math.min(cols, ordered.length - row * cols);
        var x = (areaW - inRow * cellW) / 2 + col * cellW + cellW / 2;
        var ny = rowsY0 + row * MapView.CELL_H + MapView.CELL_H * 0.4;
        pos[n.id] = { x: x, y: ny, r: 5 + 1.5 * (n.size || 3), n: n, cw: cellW };
        x0 = Math.min(x0, x - cellW / 2); x1 = Math.max(x1, x + cellW / 2);
      }
      if (!ordered.length) { x0 = 0; x1 = areaW; }
      bands.push({ lay: lay, y: y, h: h, n: ordered.length, nodeIds: nodeIds, x0: x0, x1: x1, seg: U.segment(lay.kind) });
      y += h;
    }
    var railNodes = rail.flatMap(function (l) { return APP.idx.byLayer[l.id] || []; });
    var railX = areaW + railW / 2;
    var step = railNodes.length > 1 ? (y - 100) / (railNodes.length - 1) : 0;
    railNodes.forEach(function (n, i) { pos[n.id] = { x: railX, y: 64 + i * step, r: 5 + 1.5 * (n.size || 3), n: n, rail: true, cw: railW }; });
    MapView.layout = { pos: pos, bands: bands, worldW: areaW + railW, worldH: y, areaW: areaW, railX: railX, railW: railW, cols: cols, rail: rail };
    MapView._cardCache = {};
  },

  /* ==================================================================
     Chain: breadth-first over supply links, up to maxHops
     ================================================================== */
  computeChain(nodeId, maxHops) {
    if (!nodeId || !APP.idx.nodeById[nodeId]) return null;
    var chain = new Map(); chain.set(nodeId, 0);
    var queue = [nodeId], front = 0;
    while (front < queue.length) {
      var cur = queue[front++], hop = chain.get(cur);
      if (hop >= maxHops) continue;
      var inn = APP.idx.inn[cur] || [], out = APP.idx.out[cur] || [];
      for (var i = 0; i < inn.length; i++) if (inn[i].k === "supplies" && !chain.has(inn[i].s)) { chain.set(inn[i].s, hop + 1); queue.push(inn[i].s); }
      for (i = 0; i < out.length; i++) if (out[i].k === "supplies" && !chain.has(out[i].t)) { chain.set(out[i].t, hop + 1); queue.push(out[i].t); }
    }
    /* direct non-supply partners of the selected node stay visible too */
    (APP.idx.inn[nodeId] || []).concat(APP.idx.out[nodeId] || []).forEach(function (e) { var o = e.s === nodeId ? e.t : e.s; if (!chain.has(o)) chain.set(o, 1); });
    return chain;
  },

  nodeColour(n, T) {
    if (MapView.colourBy === "today") {
      var q = typeof Live !== "undefined" && Live.ready ? Live.node(n.id) : null;
      if (!q || q.c == null) return T["line"] || T["ink-3"];
      var cs = MapView._liveCols || (MapView._liveCols = (function () { var g = getComputedStyle(document.documentElement); return { up: g.getPropertyValue("--c-up").trim() || T.accent, down: g.getPropertyValue("--c-down").trim() || T.warn }; })());
      MapView._todayAlpha = Math.max(0.3, Math.min(1, Math.abs(q.c) / 3));
      return q.c >= 0 ? cs.up : cs.down;
    }
    if (MapView.colourBy === "bottleneck") {
      var bn = n.bn && n.bn.effective;
      if (bn == null) return T["ink-3"];
      if (bn < 2) return T.accent;
      if (bn < 3) return T["seg-chips"];
      if (bn < 4) return T.warn;
      return T["seg-infra"];
    }
    if (MapView.colourBy === "stale") {
      if (n.stale && n.stale.length) return T.warn;
      if (n.fin || n.cap || n.ev) return T.accent;
      return T["ink-3"];
    }
    return T["seg-" + U.segment(U.layerOf(n.layer).kind)] || T["ink-3"];
  },

  /* ==================================================================
     Transform and camera
     ================================================================== */
  fitTf() {
    var L = MapView.layout, a = MapView.avail(true);
    var k = Math.min(a.w / L.worldW, a.h / L.worldH, 1.4);
    return { k: k, x: a.x0 + Math.max(0, (a.w - L.worldW * k) / 2), y: a.y0 + Math.max(0, (a.h - L.worldH * k) / 2) };
  },
  fit(animate) { MapView.goTo(MapView.fitTf(), animate); },
  minK() { return Math.min(MapView.fitTf().k * 0.8, 0.3); },
  clampPan() {
    var L = MapView.layout, t = MapView.tf, a = MapView.avail(true);
    var W = L.worldW * t.k, H = L.worldH * t.k;
    if (W <= a.w) t.x = Math.min(Math.max(t.x, a.x0), a.x1 - W); else t.x = Math.min(a.x0 + 40, Math.max(a.x1 - W - 40, t.x));
    if (H <= a.h) t.y = Math.min(Math.max(t.y, a.y0), a.y1 - H); else t.y = Math.min(a.y0 + 40, Math.max(a.y1 - H - 40, t.y));
  },
  goTo(target, animate) {
    if (MapView._anim) cancelAnimationFrame(MapView._anim);
    MapView._anim = null;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate || reduce) { MapView.tf = { k: target.k, x: target.x, y: target.y }; MapView.request(); return; }
    var s = { k: MapView.tf.k, x: MapView.tf.x, y: MapView.tf.y }, t0 = performance.now(), dur = 380;
    function ease(t) { return 1 - Math.pow(1 - t, 3); }
    function step() {
      var t = Math.min(1, (performance.now() - t0) / dur), e = ease(t);
      MapView.tf = { k: s.k + (target.k - s.k) * e, x: s.x + (target.x - s.x) * e, y: s.y + (target.y - s.y) * e };
      MapView.draw();
      MapView._anim = t < 1 ? requestAnimationFrame(step) : null;
    }
    MapView._anim = requestAnimationFrame(step);
  },
  zoomBy(f, cx, cy, animate) {
    var a = MapView.avail();
    cx = cx != null ? cx : (a.x0 + a.x1) / 2; cy = cy != null ? cy : (a.y0 + a.y1) / 2;
    var t = MapView.tf, k2 = Math.max(MapView.minK(), Math.min(4, t.k * f));
    var target = { k: k2, x: cx - (cx - t.x) * (k2 / t.k), y: cy - (cy - t.y) * (k2 / t.k) };
    if (animate) MapView.goTo(target, true); else { MapView.tf = target; MapView.clampPan(); MapView.request(); }
  },
  /* Centre a node in the free area (left of the side panel, above the phone sheet). */
  focusNode(id, animate) {
    var p = MapView.layout && MapView.layout.pos[id]; if (!p) return;
    var a = MapView.avail(), k = Math.max(MapView.tf.k, MapView.w < 640 ? 0.75 : 0.9);
    MapView.goTo({ k: k, x: (a.x0 + a.x1) / 2 - p.x * k, y: (a.y0 + a.y1) / 2 - p.y * k }, animate !== false);
  },
  /* Bring one layer's band into view, zoomed so its companies can be read. Used by
     the Overview, the Layers menu, the layer column, and the l= hash parameter. */
  focusLayer(layerId, animate) {
    if (!MapView.layout) return;
    var b = MapView.layout.bands.find(function (bb) { return bb.lay.id === layerId; });
    if (!b) {
      if (MapView.layout.rail.some(function (l) { return l.id === layerId; })) {
        var a0 = MapView.avail(), L = MapView.layout, k0 = Math.min(1, a0.h / L.worldH * 1.6);
        MapView.goTo({ k: k0, x: a0.x1 - L.worldW * k0 - 10, y: a0.y0 }, animate !== false);
      }
      return;
    }
    var a = MapView.avail(), bw = (b.x1 - b.x0) + 40;
    var k = Math.min(a.w / bw, a.h * 0.8 / b.h, 1.15);
    k = Math.max(k, MapView.fitTf().k);
    var cx = (b.x0 + b.x1) / 2, cy = b.y + b.h / 2;
    MapView.goTo({ k: k, x: (a.x0 + a.x1) / 2 - cx * k, y: (a.y0 + a.y1) / 2 - cy * k }, animate !== false);
  },
  jumpToLayer(layerId) { MapView.focusLayer(layerId); },

  /* Follow the URL: a newly selected layer is brought into view; a newly selected
     node is brought into view only if it is off screen or under the panel. */
  syncFocus(animate) {
    if (!MapView.layout || U.$("#view-map").hidden) return;
    var s = APP.state;
    if (s.layer !== MapView._seenLayer) { MapView._seenLayer = s.layer; if (s.layer && !s.node) MapView.focusLayer(s.layer, animate); }
    if (s.node !== MapView._seenNode) {
      MapView._seenNode = s.node;
      var p = s.node && MapView.layout.pos[s.node];
      if (p) {
        var a = MapView.avail(), sx = p.x * MapView.tf.k + MapView.tf.x, sy = p.y * MapView.tf.k + MapView.tf.y;
        if (sx < a.x0 + 20 || sx > a.x1 - 20 || sy < a.y0 + 20 || sy > a.y1 - 20) MapView.focusNode(s.node, animate);
      }
    }
  },

  toScreen(p) { var t = MapView.tf; return [p.x * t.k + t.x, p.y * t.k + t.y]; },
  nodeR(p) { var k = MapView.tf.k; return Math.max(2.6, Math.min(p.r * k, p.r * Math.max(k, 0.55))); },

  /* ==================================================================
     Hit testing, in screen space
     ================================================================== */
  hit(px, py, slop) {
    var best = null, bd = Infinity, all = MapView.layout.pos, t = MapView.tf;
    slop = slop || 5;
    for (var id in all) {
      var p = all[id], sx = p.x * t.k + t.x, sy = p.y * t.k + t.y, r = MapView.nodeR(p);
      var d = Math.hypot(sx - px, sy - py);
      if (d < r + slop && d < bd) { bd = d; best = p; }
    }
    return best;
  },
  bandAt(py) {
    var t = MapView.tf, wy = (py - t.y) / t.k;
    return MapView.layout.bands.find(function (b) { return wy >= b.y && wy < b.y + b.h; }) || null;
  },

  /* ==================================================================
     Pointer: drag to pan, two fingers to pinch, click or tap to select
     ================================================================== */
  onDown(e) {
    if (e.button != null && e.button > 0) return;
    if (MapView._anim) { cancelAnimationFrame(MapView._anim); MapView._anim = null; }
    MapView._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (MapView._ptrs.size === 1) {
      MapView._drag = { x: e.clientX, y: e.clientY, tx: MapView.tf.x, ty: MapView.tf.y, moved: false, onCanvas: e.currentTarget === MapView.canvas, type: e.pointerType };
      MapView._dragMoved = false;
    } else if (MapView._ptrs.size === 2) {
      var pts = [...MapView._ptrs.values()];
      MapView._pinch = { d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1, mx: (pts[0].x + pts[1].x) / 2, my: (pts[0].y + pts[1].y) / 2, tf0: Object.assign({}, MapView.tf) };
      if (MapView._drag) MapView._drag.moved = true;
      MapView._dragMoved = true;
    }
    if (e.currentTarget === MapView.canvas) MapView.canvas.classList.add("dragging");
  },
  onMove(e) {
    if (!MapView._ptrs.has(e.pointerId)) return;
    MapView._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    var r = MapView.canvas.getBoundingClientRect();
    if (MapView._pinch && MapView._ptrs.size >= 2) {
      var pts = [...MapView._ptrs.values()], P = MapView._pinch;
      var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      var mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
      var k = Math.max(MapView.minK(), Math.min(4, P.tf0.k * d / P.d0));
      var ox = P.mx - r.left, oy = P.my - r.top;
      MapView.tf = { k: k, x: (mx - r.left) - (ox - P.tf0.x) * (k / P.tf0.k), y: (my - r.top) - (oy - P.tf0.y) * (k / P.tf0.k) };
      MapView.clampPan(); MapView.tip(null); MapView.request(); return;
    }
    var D = MapView._drag; if (!D) return;
    var dx = e.clientX - D.x, dy = e.clientY - D.y;
    if (!D.moved && Math.abs(dx) + Math.abs(dy) > (D.type === "touch" ? 8 : 4)) { D.moved = true; MapView._dragMoved = true; }
    if (!D.moved) return;
    MapView.tf.x = D.tx + dx; MapView.tf.y = D.ty + dy;
    MapView.clampPan(); MapView.tip(null); MapView.request();
  },
  onUp(e) {
    if (!MapView._ptrs.has(e.pointerId)) return;
    MapView._ptrs.delete(e.pointerId);
    if (MapView._ptrs.size === 1 && MapView._pinch) {
      /* one finger left after a pinch: keep panning from where it is */
      var rest = [...MapView._ptrs.values()][0];
      MapView._pinch = null;
      MapView._drag = { x: rest.x, y: rest.y, tx: MapView.tf.x, ty: MapView.tf.y, moved: true, onCanvas: false };
      return;
    }
    if (MapView._ptrs.size) return;
    var D = MapView._drag; MapView._drag = null; MapView._pinch = null;
    MapView.canvas.classList.remove("dragging");
    if (!D || D.moved || !D.onCanvas || e.type === "pointercancel") return;
    var r = MapView.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    var p = MapView.hit(x, y, D.type === "touch" ? 12 : 5);
    if (p) { MapView.kbFocus = p.n.id; MapView.tip(null); State.set({ node: p.n.id, layer: null }); return; }
    if (APP.state.node || APP.state.layer) State.set({ node: null, layer: null });
  },
  onHover(e) {
    if (MapView._drag || e.pointerType === "touch") return;
    var r = MapView.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    var p = MapView.hit(x, y), b = MapView.bandAt(y);
    var changed = (p && p.n.id) !== (MapView.hover && MapView.hover.n.id) || (b && b.lay.id) !== (MapView.hoverBand && MapView.hoverBand.lay.id);
    MapView.hover = p; MapView.hoverBand = b;
    if (changed) MapView.request();
    MapView.canvas.style.cursor = p ? "pointer" : "grab";
    MapView.tip(p, x, y);
  },
  onWheel(e) {
    e.preventDefault();
    var r = MapView.canvas.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      MapView.zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      return;
    }
    var f = e.deltaMode === 1 ? 16 : 1;
    MapView.tf.x -= (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * f;
    if (!e.shiftKey) MapView.tf.y -= e.deltaY * f;
    MapView.clampPan(); MapView.tip(null); MapView.request();
  },

  /* ==================================================================
     Keyboard
     ================================================================== */
  onKeyDown(e) {
    if (!MapView.layout) return;
    var bands = MapView.layout.bands;
    if (e.key === "Escape") { if (APP.state.node || APP.state.layer) Panel.close(); MapView.kbFocus = null; MapView.request(); return; }
    if (e.key === "Enter" || e.key === " ") {
      if (MapView.kbFocus) { e.preventDefault(); State.set({ node: MapView.kbFocus, layer: null }); MapView.focusNode(MapView.kbFocus); }
      return;
    }
    if (e.key === "+" || e.key === "=" || e.key === "-") { e.preventDefault(); MapView.zoomBy(e.key === "-" ? 1 / 1.3 : 1.3, null, null, true); return; }
    if (e.key === "0") { e.preventDefault(); MapView.fit(true); return; }
    if (e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault(); MapView.tf.y += (e.key === "PageDown" ? -1 : 1) * MapView.h * 0.8; MapView.clampPan(); MapView.request(); return;
    }
    if ((e.key === "Home" || e.key === "End") && bands.length) {
      e.preventDefault();
      var band = e.key === "Home" ? bands[0] : bands[bands.length - 1];
      MapView.focusLayer(band.lay.id);
      if (band.nodeIds.length) MapView.kbFocus = band.nodeIds[0];
      MapView.request(); return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].indexOf(e.key) < 0) return;
    e.preventDefault();
    var bi = -1, ni = -1;
    if (MapView.kbFocus) for (var i = 0; i < bands.length; i++) { var ix = bands[i].nodeIds.indexOf(MapView.kbFocus); if (ix >= 0) { bi = i; ni = ix; break; } }
    if (bi < 0) { bi = 0; ni = 0; }
    else if (e.key === "ArrowRight") ni = Math.min(ni + 1, bands[bi].nodeIds.length - 1);
    else if (e.key === "ArrowLeft") ni = Math.max(ni - 1, 0);
    else if (e.key === "ArrowDown") { bi = Math.min(bi + 1, bands.length - 1); ni = Math.min(ni, bands[bi].nodeIds.length - 1); }
    else if (e.key === "ArrowUp") { bi = Math.max(bi - 1, 0); ni = Math.min(ni, bands[bi].nodeIds.length - 1); }
    var ids = bands[bi].nodeIds;
    if (ids.length) {
      MapView.kbFocus = ids[Math.max(0, Math.min(ni, ids.length - 1))];
      var fp = MapView.layout.pos[MapView.kbFocus], s = MapView.toScreen(fp), a = MapView.avail();
      if (s[0] < a.x0 + 30 || s[0] > a.x1 - 30 || s[1] < a.y0 + 30 || s[1] > a.y1 - 30) MapView.focusNode(MapView.kbFocus);
      MapView.tip(fp, s[0], s[1]);
      MapView.request();
    }
  },

  /* ==================================================================
     Words: categories, countries, plain-language layer facts
     ================================================================== */
  catName(cat) {
    if (!cat || cat === "_") return "";
    var UP = { ai: "AI", us: "US", eu: "EU", it: "IT", hbm: "HBM", dram: "DRAM", nand: "NAND", gpu: "GPU", cpu: "CPU", asic: "ASIC", osat: "OSAT", odm: "ODM", oem: "OEM", epc: "EPC", ups: "UPS", cmp: "CMP", abf: "ABF", ule: "ULE", tso: "TSO", idm: "IDM" };
    var s = cat.split("_").map(function (w) { return w === "rnd" ? "R&D" : (UP[w] || w); }).join(" ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
  countryName(iso) {
    if (!iso) return "";
    if (!MapView._countries) { MapView._countries = {}; ((APP.data.views || {}).country || []).forEach(function (c) { MapView._countries[c.iso] = c.name; }); }
    return MapView._countries[iso] || iso;
  },
  TYPE_WORD: { company: "", segment: "Market segment", product: "Product", resource: "Raw material", fund: "Fund" },
  OWN_WORD: { public: "Listed", private: "Private", subsidiary: "Subsidiary", state: "State-owned", foundation: "Foundation-owned", cooperative: "Cooperative" },
  usd(v) { return v == null ? "" : v >= 1000 ? "$" + U.num(v / 1000, v >= 10000 ? 1 : 2) + "tn" : v >= 10 ? "$" + U.num(v, 0) + "bn" : "$" + U.num(v, 1) + "bn"; },
  gradeWord(c) { return { A: "official filing", B: "company or reputable dataset", C: "press or market data", D: "our estimate" }[c] || ""; },

  /* Plain-English facts about a layer, each with a tooltip that says what it means. */
  layerFacts(b) {
    var lay = b.lay, t = lay.totals || {}, f = t.fin || {}, out = [];
    if (lay.score != null) out.push({ cls: "score", html: '<span class="lf-meter"><i style="width:' + Math.max(0, Math.min(100, lay.score / 5 * 100)) + '%"></i></span>Bottleneck <b>' + U.num(lay.score, 1) + "</b> of 5",
      tip: "Bottleneck score " + lay.score + " of 5: how hard it is to get more of what this layer makes. 0 means plenty of slack; 5 means sold out, few suppliers and years to add capacity. Our calculation from sourced utilisation, lead times, backlogs and market shares." });
    else out.push({ cls: "score none", html: "Bottleneck: not scored", tip: "Too few companies in this layer publish utilisation, lead times or market shares to score it with confidence." });
    var fill = t.fill_pct;
    if (fill != null && fill > 100.5 && t.utilization_mean != null) fill = Fmt.pctOf(t.utilization_mean);
    if (fill != null) out.push({ html: "Capacity in use <b>" + U.num(fill, 0) + "%</b>", tip: "How much of the layer's production capacity is running, " + (t.fill_source === "nodes" ? "averaged over the companies that disclose it." : "from a layer-level source.") + " Near 100% means little room to make more." });
    else if (t.supply_gap_pct != null) out.push({ html: "Supply short by <b>" + U.num(t.supply_gap_pct, 0) + "%</b> of demand", tip: "Tracked supply falls short of tracked demand by this share." });
    var cg = t.capacity_growth_pct_yr, dg = t.demand_growth_pct_yr;
    if (cg != null || dg != null) {
      var lag = cg != null && dg != null && cg < dg;
      var gHtml = cg != null && dg != null ? "Supply <b>" + Fmt.growth(cg, "") + "</b> · demand <b>" + Fmt.growth(dg, "") + "</b> a year"
        : cg != null ? "Supply growing <b>" + Fmt.growth(cg, "") + "</b> a year" : "Demand growing <b>" + Fmt.growth(dg, "") + "</b> a year";
      out.push({ cls: lag ? "lag" : "", html: gHtml,
        tip: "Annual growth of tracked production capacity versus annual growth of demand for this layer's output." + (lag ? " Demand is growing faster than supply, so the layer is tightening." : cg != null && dg != null ? " Supply is growing at least as fast as demand." : " One side is not quantified.") });
    }
    if (f.mcap_sum_usd_bn != null || f.pe_fwd_median != null) {
      var bits = [];
      if (f.mcap_sum_usd_bn != null) bits.push("<b>" + MapView.usd(f.mcap_sum_usd_bn) + "</b> listed value");
      if (f.pe_fwd_median != null) bits.push("<b>" + U.num(f.pe_fwd_median, 1) + "×</b> earnings");
      out.push({ html: bits.join(" · "), tip: (f.mcap_sum_usd_bn != null ? "Combined stock-market value of the " + (f.n_listed || "") + " listed companies in this layer. " : "") + (f.pe_fwd_median != null ? "Median forward price-to-earnings ratio: share price divided by the earnings analysts expect over the next 12 months (" + (f.pe_fwd_n || "") + " companies). Market data, grade C." : "") });
    }
    var nb = [b.n + (b.n === 1 ? " company or market" : " companies and markets")];
    out.push({ cls: "count", html: nb[0] + (t.n_risks ? " · <b>" + t.n_risks + "</b> risk" + (t.n_risks > 1 ? "s" : "") : ""),
      tip: b.n + " nodes in this layer" + (t.n_est_only != null ? ", of which " + t.n_est_only + " rest on our estimates only (no published figure yet)" : "") + "." + (t.n_risks ? " " + t.n_risks + " recorded risks; open the layer for details." : "") });
    return out;
  },

  /* ==================================================================
     Hover card
     ================================================================== */
  tip(p, x, y) {
    var hc = MapView._hoverCard, t = U.$("#map-tip");
    if (t) t.hidden = true;
    if (!p) { if (hc) hc.hidden = true; return; }
    hc.innerHTML = MapView._renderHoverCard(p.n);
    hc.hidden = false;
    var cw = hc.offsetWidth, ch = hc.offsetHeight, a = MapView.avail();
    var left = x + 16 + cw > a.x1 ? x - 16 - cw : x + 16;
    var top = y + 16 + ch > MapView.h - 8 ? y - 16 - ch : y + 16;
    hc.style.left = Math.max(4, left) + "px"; hc.style.top = Math.max(4, top) + "px";
    hc.style.right = "auto"; hc.style.bottom = "auto";
  },
  _renderHoverCard(n) {
    var lay = U.layerOf(n.layer), seg = U.segment(lay.kind), fin = n.fin || {}, bn = n.bn || {};
    var esc = U.esc;
    var idBits = [];
    if (n.tk) idBits.push('<span class="tk">' + esc(n.tk) + (n.ex ? " · " + esc(n.ex) : "") + "</span>");
    else if (MapView.OWN_WORD[n.own] && n.type === "company") idBits.push("<span>" + MapView.OWN_WORD[n.own] + "</span>");
    if (MapView.TYPE_WORD[n.type]) idBits.push("<span>" + MapView.TYPE_WORD[n.type] + "</span>");
    if (n.hq) idBits.push("<span>" + esc(MapView.countryName(n.hq)) + "</span>");
    var cat = MapView.catName(n.cat);
    var role = (cat && cat.toLowerCase() !== "market" ? esc(cat) + " · " : "") + esc(lay.name);
    var rows = "";
    var val = fin.mcap ? { l: "Market value", t: fin.mcap } : fin.val ? { l: "Last private valuation", t: fin.val } : null;
    var q = typeof Live !== "undefined" && Live.ready ? Live.node(n.id) : null;
    if (q) rows += "<dt>Share price</dt><dd>" + U.num(q.p, 2) + " " + Live.chg(q.c) + "</dd>";
    if (val && val.t[0] != null) rows += "<dt>" + val.l + "</dt><dd>" + MapView.usd(val.t[0]) +  ' <span class="hc-asof">' + (val.t[3] === "live" ? "live" : esc(U.asOf(val.t[1])) + (val.t[2] === "D" ? ", our estimate" : "")) + "</span></dd>";
    if (n.cap && n.cap.share && n.cap.share[0] != null) rows += "<dt>Share of its market</dt><dd>" + Fmt.sharePct(n.cap.share[0]) + (n.cap.share[2] === "D" ? ' <span class="hc-asof">our estimate</span>' : "") + "</dd>";
    if (bn.effective != null) rows += "<dt>Bottleneck score</dt><dd>" + bn.effective + " of 5</dd>";
    var est = !(n.fin && Object.keys(n.fin).length) && !(n.cap && n.cap.cur);
    var sum = n.sum ? '<p class="hc-summary">' + esc(n.sum) + "</p>" : "";
    var touch = window.matchMedia && window.matchMedia("(hover: none)").matches;
    return '<div class="hc-name"><span class="dot" style="background:var(--seg-' + seg + ')"></span>' + esc(n.name) + "</div>" +
      '<div class="hc-meta">' + idBits.join("") + "</div>" +
      '<div class="hc-role" style="border-color:var(--seg-' + seg + ')">' + role + "</div>" +
      (rows ? '<dl class="hc-stats">' + rows + "</dl>" : "") + sum +
      (est ? '<div class="hc-flags"><span class="hc-flag">figures are our estimates only</span></div>' : "") +
      '<div class="hc-hint">' + (touch ? "Tap" : "Click") + " for numbers, sources and links</div>";
  },

  /* ==================================================================
     Layer column (DOM), kept aligned with the bands every frame
     ================================================================== */
  updateGutter() {
    var gut = MapView._gutter, L = MapView.layout; if (!gut || !L) return;
    var t = MapView.tf, top0 = MapView.HEAD_H, gH = MapView.h - top0, narrow = MapView.w < 640;
    if (gut._n !== L.bands.length) {
      gut._n = L.bands.length;
      gut.innerHTML = L.bands.map(function (b) { return '<button type="button" role="listitem" class="mg-card" data-layer="' + U.esc(b.lay.id) + '" style="--seg:var(--seg-' + b.seg + ')"></button>'; }).join("");
      U.$$(".mg-card", gut).forEach(function (el) {
        U.on(el, "click", function () { if (MapView._dragMoved) return; var id = el.getAttribute("data-layer"); if (APP.state.layer === id && !APP.state.node) MapView.focusLayer(id); else State.set({ layer: id, node: null }); });
        U.on(el, "pointerenter", function (e) { if (e.pointerType === "touch") return; MapView.hoverBand = L.bands.find(function (b) { return b.lay.id === el.getAttribute("data-layer"); }); MapView.request(); });
        U.on(el, "pointerleave", function () { MapView.hoverBand = null; MapView.request(); });
      });
      gut._cards = U.$$(".mg-card", gut);
    }
    gut.style.top = top0 + "px";
    for (var i = 0; i < L.bands.length; i++) {
      var b = L.bands[i], el = gut._cards[i];
      var y0 = b.y * t.k + t.y - top0, y1 = (b.y + b.h) * t.k + t.y - top0;
      var vy0 = Math.max(0, y0), vy1 = Math.min(gH, y1), h = vy1 - vy0;
      if (h < (narrow ? 11 : 6)) { if (!el.hidden) el.hidden = true; continue; }
      if (el.hidden) el.hidden = false;
      el.style.transform = "translateY(" + vy0.toFixed(1) + "px)";
      el.style.height = h.toFixed(1) + "px";
      var sel = APP.state.layer === b.lay.id && !APP.state.node;
      el.classList.toggle("is-sel", sel);
      el.classList.toggle("is-hov", !!(MapView.hoverBand && MapView.hoverBand.lay.id === b.lay.id));
      el.classList.toggle("seg-start", i === L.bands.length - 1 || L.bands[i + 1].seg !== b.seg);
      /* how much fits: the title, then as many plain-language facts as there is room for */
      var lines = narrow ? 0 : Math.max(0, Math.floor((h - 36) / 16));
      var tLines = narrow ? Math.max(1, Math.min(3, Math.floor((h - 4) / 12))) : (h >= 52 ? 2 : 1);
      var eye = !narrow && h >= 34;
      if (!narrow && h < 34) tLines = 1;
      var key = lines + ":" + tLines + ":" + narrow + ":" + eye;
      if (el._key !== key) { el._key = key; el.innerHTML = MapView._cardHtml(b, lines, tLines, narrow, eye); }
    }
  },
  _cardHtml(b, lines, tLines, narrow, eye) {
    var lay = b.lay, esc = U.esc;
    var facts = lines ? MapView.layerFacts(b).slice(0, lines) : [];
    var tip = lay.name + ". " + (lay.description || "") + " Click to open this layer.";
    var eyebrow = !eye ? "" : '<span class="mg-eye"><span class="mg-no">L' + Math.round(lay.order) + "</span>" + esc(SEGMENT_LABEL[b.seg] || "") + "</span>";
    return eyebrow + '<span class="mg-name" style="-webkit-line-clamp:' + tLines + '" title="' + esc(tip) + '">' + esc(lay.name) + "</span>" +
      facts.map(function (f) { return '<span class="mg-fact ' + (f.cls || "") + '" title="' + esc(f.tip) + '">' + f.html + "</span>"; }).join("");
  },

  updateChainLegend() {
    var el = MapView._chainLegend; if (!el) return;
    var sel = APP.state.node, chain = MapView._chainCache;
    if (!sel || !chain || (MapView.w <= 720 && MapView._panelOpen())) { el.hidden = true; return; }
    var node = U.nodeOf(sel); if (!node) { el.hidden = true; return; }
    var a = MapView.avail();
    el.hidden = false;
    el.style.left = (MapView.GUTTER + 10) + "px";
    el.style.bottom = (MapView.h - a.y1 + 6) + "px";
    if (el._for === sel) return;
    el._for = sel;
    el.innerHTML = '<div class="cl-title">Supply chain of ' + U.esc(node.name) + "</div>" +
      '<div class="cl-stats">' + (chain.size - 1) + " linked companies and markets, up to three steps away</div>" +
      '<div class="cl-hops"><span class="cl-hop"><i></i>direct</span><span class="cl-hop"><i style="opacity:.6"></i>two steps</span><span class="cl-hop"><i style="opacity:.3"></i>three steps</span>' +
      '<button type="button" class="cl-clear">Clear</button></div>';
    U.on(U.$(".cl-clear", el), "click", function () { State.set({ node: null }); });
  },

  _buildLayerList() {
    var bands = MapView.layout.bands, html = "";
    for (var i = 0; i < bands.length; i++) {
      var b = bands[i];
      html += '<button role="menuitem" data-jump="' + b.lay.id + '"' + (APP.state.layer === b.lay.id ? ' class="here" aria-current="true"' : "") + '><span class="dot" style="background:var(--seg-' + b.seg + ')"></span>' +
        '<span class="ln-name">' + U.esc(b.lay.name) + '</span><span class="ln-score" title="companies and markets in this layer">' + b.n + "</span></button>";
    }
    MapView.layout.rail.forEach(function (l) { html += '<button role="menuitem" data-jump="' + l.id + '"><span class="dot hollow"></span><span class="ln-name">' + U.esc(l.name) + '</span><span class="ln-score">' + (APP.idx.byLayer[l.id] || []).length + "</span></button>"; });
    MapView._layerList.innerHTML = html;
    U.$$("button[data-jump]", MapView._layerList).forEach(function (btn) {
      U.on(btn, "click", function () { var id = btn.getAttribute("data-jump"); MapView._layerList.hidden = true; State.set({ layer: id, node: null }); MapView.focusLayer(id); });
    });
  },

  request() {
    if (MapView.needsDraw) return;
    MapView.needsDraw = true;
    requestAnimationFrame(function () { MapView.needsDraw = false; MapView.draw(); });
  },

  /* ==================================================================
     Legend, follows the colour mode
     ================================================================== */
  legend() {
    var el = U.$("#map-legend"); if (!el) return;
    el.setAttribute("aria-label", "Map legend");
    var shape = '<span class="lg-sep" aria-hidden="true"></span>' +
      '<span title="Dot area follows market value, or market share for products and raw materials"><i class="size"></i><i class="size big"></i>Size: value</span>' +
      '<span title="Every figure for this node is our estimate; no published number yet"><i class="dashed"></i>Our estimate only</span>' +
      '<span title="Funds, lenders and banks that pay for the buildout, in the right-hand column"><i class="hollow"></i>Capital provider</span>';
    if (MapView.colourBy === "today") {
      el.innerHTML = '<span class="lg-cap">Share price today</span>' +
        '<span title="Fell more than 3% since the previous close"><i style="background:var(--c-down)"></i>down 3% or more</span>' +
        '<span><i style="background:var(--c-down);opacity:.4"></i>slightly down</span><span><i style="background:var(--c-up);opacity:.4"></i>slightly up</span>' +
        '<span><i style="background:var(--c-up)"></i>up 3% or more</span><span title="Private companies, products and markets have no share price"><i style="background:var(--c-line)"></i>not listed</span>' +
        (typeof Live !== "undefined" && Live.ready ? '<span class="lg-live">' + Live.dot() + 'updated <span class="live-ago">' + Live.ago() + "</span></span>" : "");
    } else if (MapView.colourBy === "bottleneck") {
      el.innerHTML = '<span class="lg-cap">Bottleneck score</span>' +
        '<span><i style="background:var(--c-accent)"></i>under 2</span><span><i style="background:var(--seg-chips)"></i>2 to 3</span>' +
        '<span><i style="background:var(--c-warn)"></i>3 to 4</span><span><i style="background:var(--seg-infra)"></i>4 to 5, tightest</span>' +
        '<span><i style="background:var(--c-ink-3)"></i>not scored</span>' + shape;
    } else if (MapView.colourBy === "stale") {
      el.innerHTML = '<span class="lg-cap">Data freshness</span>' +
        '<span><i style="background:var(--c-accent)"></i>current figures</span><span><i style="background:var(--c-warn)"></i>some figures out of date</span>' +
        '<span><i style="background:var(--c-ink-3)"></i>no figures yet</span>' + shape;
    } else {
      var order = ["materials", "tools", "silicon", "chips", "infra", "operators", "consumers"].filter(function (k) { return SEGMENT_LABEL[k]; });
      el.innerHTML = '<span class="lg-cap">From the bottom up</span>' + order.map(function (k) {
        return '<span><i style="background:var(--seg-' + k + ')"></i>' + U.esc(SEGMENT_LABEL[k]) + "</span>";
      }).join("") + shape;
    }
  },

  /* ==================================================================
     Main draw
     ================================================================== */
  draw() {
    var ctx = MapView.ctx, T = APP.tokens, L = MapView.layout, tf = MapView.tf, dpr = MapView.dpr;
    if (!L) return;
    var k = tf.k, W = MapView.w, H = MapView.h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);

    var sel = APP.state.node, selLayer = !sel ? APP.state.layer : null;
    var hov = MapView.hover && MapView.hover.n.id, kb = MapView.kbFocus;
    var hovBand = MapView.hoverBand && MapView.hoverBand.lay.id;

    /* ---- 1. bands, in screen space ---- */
    for (var bi = 0; bi < L.bands.length; bi++) {
      var b = L.bands[bi], y0 = b.y * k + tf.y, bh = b.h * k;
      if (y0 > H || y0 + bh < 0) continue;
      ctx.fillStyle = bi % 2 ? T["band-alt"] : T.band;
      ctx.fillRect(0, y0, W, bh);
      if (selLayer === b.lay.id || hovBand === b.lay.id) {
        ctx.globalAlpha = selLayer === b.lay.id ? 0.10 : 0.05;
        ctx.fillStyle = T["seg-" + b.seg] || T.accent; ctx.fillRect(0, y0, W, bh);
        ctx.globalAlpha = 1;
      }
      var segEdge = bi > 0 && L.bands[bi - 1].seg !== b.seg;
      ctx.fillStyle = segEdge ? T.line : T["line-2"] || T.line;
      ctx.fillRect(0, Math.round(y0), W, segEdge ? 1.5 : 1);
    }
    /* capital column */
    if (L.railW) {
      var rx0 = (L.areaW) * k + tf.x, ry0 = tf.y, ryh = L.worldH * k;
      ctx.fillStyle = T.surface; ctx.globalAlpha = 0.55; ctx.fillRect(rx0, ry0, L.railW * k, ryh); ctx.globalAlpha = 1;
      ctx.fillStyle = T.line; ctx.fillRect(Math.round(rx0), ry0, 1, ryh);
      ctx.fillStyle = T["ink-3"]; ctx.font = '600 10.5px "Barlow Semi Condensed", Arial, sans-serif';
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      var capY = Math.max(ry0 + 6, MapView.HEAD_H + 4);
      MapView._railHead = null;
      if (capY < ry0 + ryh - 20 && L.railW * k > 50) {
        ctx.fillText(L.railW * k > 96 ? "Capital providers" : "Capital", rx0 + L.railW * k / 2, capY);
        MapView._railHead = { x: rx0, y: capY - 2, w: L.railW * k, h: 15 };
      }
    }

    /* ---- computed state ---- */
    if (sel !== MapView._chainSel) { MapView._chainCache = sel ? MapView.computeChain(sel, 3) : null; MapView._chainSel = sel; }
    var chainMap = MapView._chainCache;
    var passes = {}, anyFilter = APP.state.country || APP.state.own || APP.state.kind || APP.state.bn || APP.state.dk || APP.state.q;
    for (var ni = 0; ni < APP.data.nodes.length; ni++) passes[APP.data.nodes[ni].id] = anyFilter ? Data.passes(APP.data.nodes[ni]) : true;
    var focusId = hov || (!chainMap ? kb : null);
    var nbs = new Set();
    if (focusId && !chainMap) {
      (APP.idx.out[focusId] || []).forEach(function (e) { nbs.add(e.t); });
      (APP.idx.inn[focusId] || []).forEach(function (e) { nbs.add(e.s); });
    }

    /* ---- 2. edges (world transform) ---- */
    ctx.save();
    ctx.translate(tf.x, tf.y); ctx.scale(k, k);
    var dashFor = function (kind) { return kind === "consumes_tokens" ? [1.5 / k, 3 / k] : kind === "supplies" ? [] : [5 / k, 3.5 / k]; };
    var strong = [];
    for (var ei = 0; ei < APP.data.edges.length; ei++) {
      var e = APP.data.edges[ei], a = L.pos[e.s], bp = L.pos[e.t]; if (!a || !bp) continue;
      if (chainMap) {
        if (!(chainMap.has(e.s) && chainMap.has(e.t))) continue;
        var direct = e.s === sel || e.t === sel;
        if (!direct && e.k !== "supplies") continue;
        strong.push({ e: e, a: a, b: bp, hop: direct ? 0 : Math.max(chainMap.get(e.s), chainMap.get(e.t)) });
      } else if (focusId) {
        if (e.s === focusId || e.t === focusId) strong.push({ e: e, a: a, b: bp, hop: 0 });
      } else {
        /* at rest: a faint wash of supply links only, so the stack reads as connected */
        if (e.k !== "supplies" || (anyFilter && !(passes[e.s] && passes[e.t]))) continue;
        ctx.strokeStyle = T.edge; ctx.lineWidth = 0.8 / k; ctx.globalAlpha = 0.55;
        MapView._curve(ctx, a, bp); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    strong.sort(function (x, y) { return y.hop - x.hop; });
    for (var si = 0; si < strong.length; si++) {
      var s = strong[si], other = s.e.s === (sel || focusId) ? s.b : s.a;
      var col = MapView.colourBy === "segment" ? (T["seg-" + U.segment(U.layerOf(other.n.layer).kind)] || T["edge-strong"]) : T["edge-strong"];
      ctx.strokeStyle = s.hop === 0 ? col : T["edge-strong"];
      ctx.globalAlpha = s.hop === 0 ? 0.9 : s.hop === 1 ? 0.45 : s.hop === 2 ? 0.28 : 0.16;
      ctx.lineWidth = (s.hop === 0 ? 1.8 : 1.1) / k;
      ctx.setLineDash(dashFor(s.e.k));
      MapView._curve(ctx, s.a, s.b); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.restore();

    /* ---- 3. nodes, in screen space ---- */
    var vis = [];
    for (var pid in L.pos) {
      var p = L.pos[pid], n = p.n;
      var sx = p.x * k + tf.x, sy = p.y * k + tf.y, r = MapView.nodeR(p);
      if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 30) continue;
      var isSel = n.id === sel, isHov = n.id === hov, isKb = n.id === kb;
      var inChain = chainMap && chainMap.has(n.id), isNb = nbs.has(n.id);
      var alpha = 1;
      if (chainMap) alpha = inChain ? Math.max(0.55, 1 - (chainMap.get(n.id) || 0) * 0.13) : 0.12;
      else if (anyFilter && !passes[n.id]) alpha = 0.15;
      else if (focusId && !isHov && !isNb && n.id !== focusId) alpha = 0.3;
      else if (selLayer && n.layer !== selLayer && !p.rail) alpha = 0.45;
      ctx.globalAlpha = alpha;
      var colr = MapView.nodeColour(n, T);
      var est = !(n.fin && Object.keys(n.fin).length) && !(n.cap && n.cap.cur);
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
      if (p.rail) {
        ctx.fillStyle = T.surface; ctx.fill();
        ctx.strokeStyle = T["ink-3"]; ctx.lineWidth = Math.max(1.2, r * 0.22); ctx.stroke();
      } else if (est) {
        ctx.fillStyle = T.surface; ctx.fill();
        ctx.globalAlpha = alpha * 0.35; ctx.fillStyle = colr; ctx.fill(); ctx.globalAlpha = alpha;
        ctx.strokeStyle = colr; ctx.lineWidth = Math.max(1.1, Math.min(2, r * 0.2)); ctx.setLineDash([Math.max(2, r * 0.45), Math.max(1.5, r * 0.3)]); ctx.stroke(); ctx.setLineDash([]);
      } else {
        if (MapView.colourBy === "today") ctx.globalAlpha = alpha * (Live.node && Live.ready && Live.node(n.id) ? MapView._todayAlpha : 0.6);
        ctx.fillStyle = colr; ctx.fill(); ctx.globalAlpha = alpha;
      }
      if (isSel || isHov) {
        ctx.globalAlpha = 1; ctx.strokeStyle = T.ink; ctx.lineWidth = isSel ? 2.5 : 1.8;
        ctx.beginPath(); ctx.arc(sx, sy, r + 3, 0, Math.PI * 2); ctx.stroke();
      } else if (isKb) {
        ctx.globalAlpha = 1; ctx.strokeStyle = T.accent; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.arc(sx, sy, r + 3, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      if (MapView.colourBy !== "stale" && n.stale && n.stale.length && k > 1.2) {
        ctx.fillStyle = T.warn; ctx.beginPath(); ctx.arc(sx + r * 0.75, sy - r * 0.75, 2.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      vis.push({ p: p, n: n, sx: sx, sy: sy, r: r, alpha: alpha, isSel: isSel, isHov: isHov, isKb: isKb, inChain: inChain, isNb: isNb });
    }

    /* ---- 4. labels ---- */
    MapView._drawLabels(ctx, T, vis, chainMap, focusId, selLayer, anyFilter, passes);

    MapView.updateGutter();
    MapView.updateChainLegend();
    var wrap = U.$("#map-wrap"); if (wrap) wrap.classList.toggle("panel-open", MapView._panelOpen() && MapView.w > 720);
  },
  _curve(ctx, a, b) {
    ctx.beginPath(); ctx.moveTo(a.x, a.y);
    if (a.rail || b.rail) { var mx = (a.x + b.x) / 2; ctx.bezierCurveTo(mx, a.y, mx, b.y, b.x, b.y); return; }
    var dy = (b.y - a.y) / 2;
    ctx.bezierCurveTo(a.x, a.y + dy, b.x, b.y - dy, b.x, b.y);
  },

  /* Labels in screen pixels with a halo, placed by priority and never overlapping.
     Where dots sit close together, every other label may move above its dot. */
  _drawLabels(ctx, T, vis, chainMap, focusId, selLayer, anyFilter, passes) {
    var k = MapView.tf.k, fs = MapView.w < 640 ? 10.5 : 11;
    var cands = [];
    for (var i = 0; i < vis.length; i++) {
      var v = vis[i], n = v.n;
      var key = v.isSel || v.isHov || v.isKb;
      if (chainMap && !v.inChain && !key) continue;
      if (anyFilter && !passes[n.id] && !key) continue;
      if (focusId && !key && !v.isNb && n.id !== focusId) continue;
      var pr = (n.size || 3);
      if (v.isSel) pr += 200; else if (v.isHov || v.isKb) pr += 180;
      else if (v.inChain) pr += 60 - (chainMap.get(n.id) || 0) * 12;
      else if (v.isNb) pr += 50;
      else if (selLayer && n.layer === selLayer) pr += 40;
      cands.push({ v: v, pr: pr, key: key });
    }
    cands.sort(function (a, b) { return b.pr - a.pr; });
    var placed = [], a = MapView.avail();
    /* the layer column and the top strip are off limits */
    placed.push({ x: -1e4, y: -1e4, w: MapView.GUTTER + 1e4, h: 3e4 });
    placed.push({ x: -1e4, y: -1e4, w: 3e4, h: 1e4 + MapView.HEAD_H });
    var lim = MapView.w - (a.panelW || 0);
    if (MapView._railHead) placed.push(MapView._railHead);
    ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.lineJoin = "round";
    for (var ci = 0; ci < cands.length; ci++) {
      var c = cands[ci], v2 = c.v;
      ctx.font = (c.key ? "600 " : "500 ") + fs + 'px "Barlow", Arial, sans-serif';
      var cell = v2.p.cw * k;
      var maxW = c.key ? 230 : v2.p.rail ? cell - 8 : Math.max(0, Math.min(170, cell * 1.8 - 8));
      if (maxW < 40) continue;
      var label = MapView._fitLabel(ctx, v2.n.name, maxW);
      /* a stub like "Tele…" tells nobody anything: show a name or nothing */
      if (!c.key && label !== v2.n.name && label.replace("…", "").length < 8) continue;
      var tw = ctx.measureText(label).width;
      var lx = Math.max(MapView.GUTTER + 4 + tw / 2, Math.min(lim - tw / 2 - 2, v2.sx));
      var below = { x: lx - tw / 2 - 2, y: v2.sy + v2.r + 2, w: tw + 4, h: fs + 3 };
      var above = { x: below.x, y: v2.sy - v2.r - 3 - fs - 2, w: below.w, h: fs + 3 };
      var mayFlip = c.key || c.pr >= 40;
      var rect = !MapView._overlaps(placed, below) ? below : mayFlip && !MapView._overlaps(placed, above) ? above : null;
      if (!rect && c.key) rect = below;
      if (!rect) continue;
      ctx.globalAlpha = c.key ? 1 : Math.max(0.35, v2.alpha);
      var ty = rect.y + 1;
      ctx.strokeStyle = T.bg; ctx.lineWidth = 3.5; ctx.strokeText(label, lx, ty);
      ctx.fillStyle = c.key ? T.ink : T["ink-2"]; ctx.fillText(label, lx, ty);
      placed.push(rect);
    }
    ctx.globalAlpha = 1;
  },

  _fitLabel(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    var t2 = text.replace(/\s*\([^)]*\)\s*$/, "");
    if (t2 !== text && t2.length > 2 && ctx.measureText(t2).width <= maxW) return t2;
    var lo = 1, hi = text.length;
    while (lo < hi) { var mid = Math.ceil((lo + hi) / 2); if (ctx.measureText(text.slice(0, mid) + "…").width <= maxW) lo = mid; else hi = mid - 1; }
    return text.slice(0, Math.max(1, lo)).replace(/[\s(,.-]+$/, "") + "…";
  },
  _overlaps(placed, r) {
    for (var i = 0; i < placed.length; i++) { var q = placed[i]; if (r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y) return true; }
    return false;
  },
};
const Sankey = {
  measure: null, level: "layer",

  /* ── The structural measure, built client-side from graph.edges ──
     A chain can be rich in supply relationships and poor in disclosed
     money. Counting the edges between two groups is then the only
     honest measure of shape, so it is offered alongside the valued
     measures and chosen automatically when the valued ones are thin. */
  STRUCT: "links_count",
  STRUCT_KINDS: { supplies: 1, licenses: 1, leases: 1, consumes_tokens: 1, finances: 1, owns: 1 },
  SPARSE_LINKS: 5,    /* fewer ribbons than this at layer level = sparse */
  MAX_RIBBONS: 60,    /* structural levels beyond this are unreadable */
  _structCache: null,

  /* ── Measure explanations (static copy) ─────────────────────── */
  _explain: {
    capex_usd: `Each ribbon adds up the <strong>disclosed value of deals</strong> between two groups: supply contracts, data-centre leases, investments, loans and acquisitions. The arrow follows the money, from the side that pays (the buyer, tenant or investor) to the side that receives it. Values are <strong>whole-contract totals as announced</strong>, not yearly spending, unless the deal says otherwise.<br><br><strong>Two-way flows.</strong> Sometimes money runs both ways between two groups: Amazon invests in Anthropic, and Anthropic pays Amazon for cloud computing. A diagram cannot draw both, so it draws <strong>only the difference</strong> and marks the ribbon with &#8644;. Hover it to see both directions.<br><br>Only deals with a published figure appear, so a thin diagram means little has been disclosed, not that little is happening.`,
    power_gw: `Each ribbon adds up the <strong>electrical capacity, in gigawatts, that one group has contracted to supply to another</strong>: power-purchase agreements, data-centre leases and chip deals sized in gigawatts. It is contracted capacity, not power actually used. One gigawatt is roughly the output of a large nuclear reactor.`,
    gpus: `Each ribbon adds up <strong>disclosed shipments of AI chips (GPUs and other accelerators)</strong> between two groups. Few of these are published, so this view is very incomplete.`,
    wafers_kwafers: `Each ribbon adds up <strong>disclosed silicon-wafer supply agreements</strong>, in thousands of wafers, yearly where the source says so.`,
    links_count: `This view counts <strong>relationships, not money</strong>. Each ribbon is the number of recorded supply, licence, lease, financing, ownership and token-usage links between two groups, whether or not anyone published a value. A wide ribbon means many separate dependencies, not one large contract. Links inside a single group are left out, and each link is counted once.`,
  },

  /* plain-English measure names for the switcher */
  NAMES: {
    capex_usd: ["Money committed", "$, deal values"],
    power_gw: ["Power contracted", "gigawatts"],
    gpus: ["AI chips shipped", "units"],
    wafers_kwafers: ["Wafers contracted", "k wafers"],
    links_count: ["Number of relationships", "count"],
  },
  _name(k, M) { return (Sankey.NAMES[k] || [M.label])[0]; },
  _unitHint(k, M) { return (Sankey.NAMES[k] || [null, U.unitLabel(M.unit)])[1]; },
  /* the two ends of a ribbon, in words, for each measure */
  _ends(k) { return k === "capex_usd" ? ["Pays", "Receives"] : k === "links_count" ? ["Supplier", "Customer"] : ["Supplies", "Receives"]; },
  GRADE: { A: "official filing or dataset", B: "company or broker statement", C: "press or market data", D: "our estimate" },

  /* ── Segment colour for a flow node ────────────────────────── */
  /* NOTE: d3-sankey overwrites node.layer with a column integer,
     so we stash the original layer ID as _layerId before layout.  */
  _segCol(d) {
    const T = APP.tokens;
    const lay = U.layerOf(d._layerId);
    return lay ? (T[`seg-${U.segment(lay.kind)}`] || T["ink-3"]) : T["ink-3"];
  },

  /* ── Active segments in the current data (for legend) ──────── */
  _activeSegments(nodes) {
    const seen = new Map();
    for (const n of nodes) {
      const lay = U.layerOf(n._layerId);
      if (!lay) continue;
      const seg = U.segment(lay.kind);
      if (!seen.has(seg)) seen.set(seg, SEGMENT_LABEL[seg] || seg);
    }
    return seen;
  },

  /* ── Formatter for the active measure ──────────────────────── */
  _fmt(M) { return M.fmt || (v => U.fmtVal(v, M.unit)); },

  /* ── Cycle detection (d3-sankey needs a DAG) ───────────────── */
  _findCycle(links) {
    const adj = new Map();
    for (const l of links) { if (!adj.has(l.s)) adj.set(l.s, []); adj.get(l.s).push(l); }
    const colour = new Map(); const stack = [];
    const WHITE = 0, GREY = 1, BLACK = 2;
    const dfs = u => {
      colour.set(u, GREY);
      for (const l of (adj.get(u) || [])) {
        const v = l.t;
        if (colour.get(v) === GREY) {
          const i = stack.findIndex(x => x.s === v);
          return (i >= 0 ? stack.slice(i) : []).concat([l]);
        }
        if ((colour.get(v) || WHITE) === WHITE) {
          stack.push(l);
          const found = dfs(v);
          if (found) return found;
          stack.pop();
        }
      }
      colour.set(u, BLACK);
      return null;
    };
    for (const n of adj.keys()) {
      if ((colour.get(n) || WHITE) === WHITE) { const c = dfs(n); if (c && c.length) return c; }
    }
    return null;
  },

  /* Drop the smallest link on each remaining cycle. Counts are never
     netted: two groups can genuinely depend on each other. */
  _dagify(links) {
    const out = links.slice(); const dropped = [];
    for (let guard = 0; guard < 200; guard++) {
      const cyc = Sankey._findCycle(out);
      if (!cyc) break;
      let small = cyc[0];
      for (const l of cyc) if (l.v < small.v) small = l;
      const i = out.indexOf(small);
      if (i < 0) break;
      out.splice(i, 1);
      dropped.push({ ...small, reason: "cycle" });
    }
    return { out, dropped };
  },

  /* ── Build the structural measure from graph.edges ─────────── */
  _structure() {
    if (Sankey._structCache) return Sankey._structCache;
    const g = APP.data;
    const byId = APP.idx.nodeById, layById = APP.idx.layerById;
    const levels = {}; let counted = 0; let skippedIntra = 0;
    for (const level of ["layer", "category"]) {
      const keyOf = nid => {
        const n = byId[nid]; if (!n) return null;
        const lay = layById[n.layer]; if (!lay) return null;
        if (level === "layer") return [n.layer, lay.name];
        const cat = (n.cat || "other").replace(/_/g, " ");
        return [`${n.layer}/${n.cat || "other"}`, `${lay.name} › ${cat}`];
      };
      const agg = new Map(); const ids = new Map();
      for (const e of g.edges) {
        if (!Sankey.STRUCT_KINDS[e.k]) continue;
        const s = keyOf(e.s), t = keyOf(e.t);
        if (!s || !t) continue;
        ids.set(s[0], s[1]); ids.set(t[0], t[1]);
        if (s[0] === t[0]) { if (level === "layer") skippedIntra++; continue; }
        if (level === "layer") counted++;
        const k = `${s[0]}\u0000${t[0]}`;
        let a = agg.get(k);
        if (!a) { a = { s: s[0], t: t[0], v: 0, n: 0, est: false, edges: [] }; agg.set(k, a); }
        a.v += 1; a.n += 1;
        if (a.edges.length < 6) a.edges.push({
          s: (byId[e.s] || {}).name || e.s, t: (byId[e.t] || {}).name || e.t,
          kind: e.k, product: e.p, year: e.y, conf: e.conf, v: 1,
        });
      }
      let { out, dropped } = Sankey._dagify([...agg.values()]);
      /* the category level can reach 160+ pairs, most of them a single
         link: draw the thickest and say how many were left out */
      let capped = 0;
      if (out.length > Sankey.MAX_RIBBONS) {
        const sorted = [...out].sort((a, b) => b.v - a.v);
        const keep = new Set(sorted.slice(0, Sankey.MAX_RIBBONS));
        capped = out.length - keep.size;
        out = out.filter(l => keep.has(l));
      }
      const used = new Set(); out.forEach(l => { used.add(l.s); used.add(l.t); });
      const nodes = [...ids.keys()].filter(k => used.has(k)).map(k => ({
        id: k, label: ids.get(k), layer: level === "layer" ? k : k.split("/")[0],
      }));
      nodes.sort((a, b) => ((layById[a.layer] || {}).order ?? 99) - ((layById[b.layer] || {}).order ?? 99));
      levels[level] = { nodes, links: out, dropped, capped };
    }
    /* A node-level link count would be one bar per company; the
       category level is the finest grain that still reads. */
    levels.top = levels.category;
    Sankey._structCache = {
      label: "Supply links (count of edges)", unit: "links", struct: true, levels,
      edge_count: counted, intra: skippedIntra,
      fmt: v => `${U.num(v, 0)} link${Math.round(v) === 1 ? "" : "s"}`,
    };
    return Sankey._structCache;
  },

  /* ── All measures: the payload's, plus the structural one ──── */
  _measures() {
    const F = APP.data.flows || {};
    const out = {};
    for (const k of Object.keys(F)) out[k] = F[k];
    /* if the pipeline ever ships its own links_count, that one wins */
    if (!out[Sankey.STRUCT] && (APP.data.edges || []).length) out[Sankey.STRUCT] = Sankey._structure();
    return out;
  },

  _levelData(M, level) {
    return M.levels[level] || M.levels.layer || { nodes: [], links: [], dropped: [] };
  },

  /* Pick the measure that actually has something to show. */
  _defaultMeasure(F) {
    const valued = Object.keys(F).filter(k => !F[k].struct);
    const rich = valued.find(k => Sankey._levelData(F[k], "layer").links.length >= Sankey.SPARSE_LINKS);
    if (rich) return rich;
    if (F[Sankey.STRUCT] && Sankey._levelData(F[Sankey.STRUCT], "layer").links.length >= 2) return Sankey.STRUCT;
    return valued[0] || Object.keys(F)[0];
  },

  /* ── Small helpers for the view ────────────────────────────── */
  _plural(n, one, many) { return `${n} ${n === 1 ? one : (many || one + "s")}`; },
  _gradeChip(c) {
    c = c || "D";
    return `<span class="grade grade-${U.esc(c)}" title="Source grade ${U.esc(c)}: ${U.esc(Sankey.GRADE[c] || "")}">${U.esc(c)}</span>`;
  },
  _kindWord(k) { return ({ supplies: "supply", leases: "lease", finances: "financing", owns: "acquisition or stake", licenses: "licence", consumes_tokens: "token use" })[k] || (k || "").replace(/_/g, " "); },
  /* name -> layer, to orient a deal so it reads in the ribbon's direction */
  _nameLayer() {
    if (Sankey._nl) return Sankey._nl;
    const m = {}; for (const n of APP.data.nodes || []) m[n.name] = n.layer;
    return (Sankey._nl = m);
  },
  /* the deal lines inside a ribbon, oriented the same way as the ribbon
     (deals are stored supplier -> customer; money ribbons run payer -> receiver) */
  _deals(l, srcLayer, M, max) {
    const NL = Sankey._nameLayer(); const fmt = Sankey._fmt(M);
    return (l.edges || []).slice(0, max).map(d => {
      let a = d.s, b = d.t;
      if (NL[d.s] !== srcLayer && NL[d.t] === srcLayer) { a = d.t; b = d.s; }
      const what = (d.product || Sankey._kindWord(d.kind) || "").replace(/_/g, " ");
      return { a, b, what, year: d.year, v: M.struct ? null : fmt(d.v), est: d.est, conf: d.conf || "D" };
    });
  },

  /* ── Main render (called by Boot) ──────────────────────────── */
  render() {
    const el = U.$("#view-flows");
    const F = Sankey._measures();
    const measures = Object.keys(F);
    if (!measures.length) { el.innerHTML = `<div class="container"><p class="note">No flow data yet.</p></div>`; return; }
    if (!window.d3 || !d3.sankey) { el.innerHTML = `<div class="container"><p class="note">The chart library did not load; flows are listed in each group's panel instead.</p></div>`; return; }
    if (!Sankey.measure || !F[Sankey.measure]) Sankey.measure = Sankey._defaultMeasure(F);
    const key = Sankey.measure;
    const M = F[key];
    const struct = !!M.struct;
    if (struct && Sankey.level === "top") Sankey.level = "category";
    const data = Sankey._levelData(M, Sankey.level);

    const nLinks = data.links.length;
    const nGroups = data.nodes.length;
    const layerLinks = Sankey._levelData(M, "layer").links.length;
    const sparse = !struct && layerLinks < Sankey.SPARSE_LINKS;
    const empty = nLinks === 0;
    const S = F[Sankey.STRUCT];
    const structLinks = S ? Sankey._levelData(S, "layer").links.length : 0;
    const name = Sankey._name(key, M);

    let banner = "";
    if (empty) {
      banner = `<div class="sk-state sk-state-empty">
        <h3>Nothing to draw here yet</h3>
        <p>No two groups in this chain have a published <b>${U.esc(name.toLowerCase())}</b> figure between them. That is a gap in what companies disclose, not a gap in the chain.</p>
        ${structLinks ? `<p><button type="button" class="btn-quiet sk-swap" data-measure="${Sankey.STRUCT}">Show the number of relationships instead</button></p>` : ""}
      </div>`;
    } else if (sparse) {
      banner = `<div class="sk-state sk-state-sparse">
        <h3>Only a handful of disclosed deals</h3>
        <p>Just ${M.edge_count} of the chain's ${APP.data.edges.length} recorded links carry a published ${U.esc(name.toLowerCase())} figure, so read this as a few individual deals rather than the shape of the whole chain.</p>
        ${structLinks ? `<p><button type="button" class="btn-quiet sk-swap" data-measure="${Sankey.STRUCT}">Show the number of relationships instead</button></p>` : ""}
      </div>`;
    } else if (struct) {
      banner = `<div class="sk-state sk-state-struct">
        <h3>Counting relationships, not money</h3>
        <p>Most links in the chain have no published dollar value, so this view counts them instead. ${M.edge_count} links cross from one group to another and are drawn${M.intra ? `; ${M.intra} more sit inside a single group and are left out` : ""}.</p>
      </div>`;
    }

    const lede = key === "capex_usd"
      ? `Each ribbon is money committed in published deals between two parts of the AI supply chain. <b>Money flows left to right, from the payer to the receiver</b>, and the thicker the ribbon, the bigger the sum.`
      : struct
        ? `Each ribbon counts the recorded relationships between two parts of the chain. <b>Read left to right, from supplier to customer</b>; thicker means more separate dependencies, not more dollars.`
        : `Each ribbon is ${U.esc(name.toLowerCase())} between two parts of the chain, in ${U.esc(Sankey._unitHint(key, M))}. <b>Read left to right, from supplier to receiver</b>; thicker means more.`;
    const levels = ["layer", "category", "top"].filter(l => !(struct && l === "top"));
    const levelName = { layer: "Layers", category: "Sub-groups", top: "Companies" };
    const levelTip = { layer: "The broad stages of the chain, such as chips or data centres", category: "Finer groups inside each stage", top: "Individual companies and segments" };

    el.innerHTML = `<div class="container sk-view">
      <div class="sk-head">
        <h2>Where the money and the megawatts go</h2>
        <p class="sk-lede">${lede}</p>
      </div>
      <div class="sk-controls">
        <div class="sk-ctl"><span class="sk-ctl-l">Show</span>
          <div class="sk-seg" role="group" aria-label="What the ribbons measure">${measures.map(m => `<button type="button" class="sk-seg-b${m === key ? " on" : ""}" data-measure="${U.esc(m)}" aria-pressed="${m === key}" title="${U.esc(F[m].label)}">${U.esc(Sankey._name(m, F[m]))}<small>${U.esc(Sankey._unitHint(m, F[m]))}</small></button>`).join("")}</div>
        </div>
        <div class="sk-ctl"><span class="sk-ctl-l">Detail</span>
          <div class="sk-seg" role="group" aria-label="Level of detail">${levels.map(l => `<button type="button" class="sk-seg-b${l === Sankey.level ? " on" : ""}" data-level="${l}" aria-pressed="${l === Sankey.level}" title="${U.esc(levelTip[l])}">${levelName[l]}</button>`).join("")}</div>
        </div>
      </div>
      ${banner}
      ${empty ? "" : `<div class="sk-summary">
        <span><b>${nLinks}</b> ${nLinks === 1 ? "flow" : "flows"} between <b>${nGroups}</b> groups, built from <b>${M.edge_count}</b> ${struct ? "recorded links" : "published deals"}</span>
        <details class="sk-explain"><summary>How to read this</summary><div class="body">${Sankey._explain[key] || "Values are contract totals as disclosed."}</div></details>
      </div>`}
      <div class="sk-legend" id="sk-legend"></div>
      <div class="sk-chart" id="sk-chart"${empty ? " hidden" : ""}>
        <div class="sankey-wrap" id="sk-wrap"></div>
        <div class="sk-tip" id="sk-tip" role="status"></div>
      </div>
      ${empty ? "" : `<p class="sk-swipe">Swipe sideways to see the whole diagram, or read the list below.</p>`}
      <div id="sk-top-wrap"></div>
      <div id="sk-dropped-wrap"></div>
      <p class="sankey-note">${data.capped ? `The ${Sankey.MAX_RIBBONS} thickest ribbons are drawn; ${data.capped} thinner ones (mostly single links) are left out of the picture but kept in the list. ` : ""}Hover a ribbon or a bar for detail; click a bar or a row to open that group's panel. Source grades: ${["A", "B", "C", "D"].map(g => `${Sankey._gradeChip(g)} ${Sankey.GRADE[g]}`).join(", ")}.</p>
    </div>`;

    U.$$(".sk-seg-b[data-measure]", el).forEach(b => U.on(b, "click", () => { Sankey.measure = b.getAttribute("data-measure"); Sankey.render(); }));
    U.$$(".sk-seg-b[data-level]", el).forEach(b => U.on(b, "click", () => { Sankey.level = b.getAttribute("data-level"); Sankey.render(); }));
    U.$$(".sk-swap", el).forEach(b => U.on(b, "click", () => { Sankey.measure = b.getAttribute("data-measure"); Sankey.render(); }));

    if (!empty) Sankey.draw(U.$("#sk-wrap"), data, M, key);
    Sankey._renderLegend(data, M, empty);
    Sankey._renderDropped(U.$("#sk-dropped-wrap"), data, M);
    Sankey._renderTopRibbons(U.$("#sk-top-wrap"), data, M, key);
  },

  /* ── Draw the Sankey SVG ───────────────────────────────────── */
  draw(wrap, data, M, key) {
    const T = APP.tokens;
    const layers = APP.idx.layerById;
    const fmt = Sankey._fmt(M);
    const nodes = data.nodes.map(n => ({ ...n, _layerId: n.layer }));
    const ids = new Set(nodes.map(n => n.id));
    const links = data.links
      .filter(l => ids.has(l.s) && ids.has(l.t))
      .map(l => ({ source: l.s, target: l.t, value: l.v, est: l.est, n: l.n, netted: l.netted, gross: l.gross, against: l.against, _raw: l }));

    /* wide enough to read; on a phone, or with many columns, the wrap scrolls sideways */
    const W0 = Math.max(860, wrap.clientWidth || 0);
    const LBL = W0 >= 1100 ? 250 : 210;         /* room for outer labels */
    const GAP = 170;                             /* minimum column spacing, so middle labels fit */
    const TOP = 44, BOT = 14, PAD = 30;
    const orderOf = d => { const lay = layers[d._layerId]; return lay ? lay.order : 99; };
    const mk = (W, H) => d3.sankey()
      .nodeId(d => d.id).nodeWidth(12).nodePadding(PAD)
      .nodeAlign(d3.sankeyLeft)
      .nodeSort((a, b) => orderOf(a) - orderOf(b))
      .extent([[LBL, TOP], [W - LBL, H - BOT]]);

    /* first pass to count columns and nodes per column, then size to fit */
    let graph, W;
    try {
      const probe = mk(W0, 600)({ nodes: nodes.map(n => ({ ...n })), links: links.map(l => ({ ...l })) });
      const perCol = d3.rollup(probe.nodes, v => v.length, d => d.depth);
      const most = Math.max(...perCol.values());
      const depth = d3.max(probe.nodes, d => d.depth) || 1;
      W = Math.max(W0, 2 * LBL + depth * GAP);
      const H = Math.max(400, Math.min(1500, most * (depth > 4 ? 84 : 70) + TOP + BOT + 40));
      graph = mk(W, H)({ nodes, links });
      graph.H = H;
    } catch (e) {
      wrap.innerHTML = `<p class="note" style="padding:12px">Could not lay out this flow (${U.esc(e.message)}).</p>`;
      return;
    }
    const H = graph.H;
    const maxDepth = d3.max(graph.nodes, d => d.depth);
    const colOf = d => Sankey._segCol(d);
    const [endL, endR] = Sankey._ends(key);

    const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("width", W).attr("height", H)
      .attr("role", "img").attr("aria-label", `${Sankey._name(key, M)}: ${links.length} flows between ${nodes.length} groups, read left to right`);
    const defs = svg.append("defs");

    /* reading-direction rule across the top */
    const dir = svg.append("g").attr("class", "sk-dir");
    dir.append("text").attr("x", LBL).attr("y", 16).attr("class", "sk-dir-end").text(endL);
    dir.append("text").attr("x", W - LBL).attr("y", 16).attr("text-anchor", "end").attr("class", "sk-dir-end").text(endR);
    dir.append("text").attr("x", W / 2).attr("y", 16).attr("text-anchor", "middle").attr("class", "sk-dir-mid")
      .text(key === "capex_usd" ? "money flows this way" : struct_(M) ? "supplier to customer" : "flows this way");
    defs.append("marker").attr("id", "sk-arrow").attr("viewBox", "0 0 8 8").attr("refX", 7).attr("refY", 4)
      .attr("markerWidth", 7).attr("markerHeight", 7).attr("orient", "auto")
      .append("path").attr("d", "M0,0 L8,4 L0,8 z").attr("class", "sk-dir-head");
    dir.append("line").attr("class", "sk-dir-line").attr("x1", LBL + 64).attr("x2", W / 2 - 80).attr("y1", 12).attr("y2", 12);
    dir.append("line").attr("class", "sk-dir-line").attr("x1", W / 2 + 80).attr("x2", W - LBL - 82).attr("y1", 12).attr("y2", 12).attr("marker-end", "url(#sk-arrow)");
    function struct_(m) { return !!m.struct; }

    /* ribbons take the colour of the side they leave (payer or supplier) */
    if (false) graph.links.forEach((l, i) => {
      const g = defs.append("linearGradient").attr("id", `sk-g${i}`).attr("gradientUnits", "userSpaceOnUse")
        .attr("x1", l.source.x1).attr("x2", l.target.x0);
      g.append("stop").attr("offset", "0%").attr("stop-color", colOf(l.source));
      g.append("stop").attr("offset", "100%").attr("stop-color", colOf(l.target));
      l._gid = `sk-g${i}`;
    });
    const linkG = svg.append("g").attr("fill", "none");
    const linkSel = linkG.selectAll("path").data(graph.links).join("path")
      .attr("class", d => `sk-link${d.est ? " est" : ""}`)
      .attr("d", d3.sankeyLinkHorizontal())
      .attr("stroke", d => colOf(d.source))
      .attr("stroke-width", d => Math.max(1.5, d.width));

    const estLinks = graph.links.filter(l => l.est);
    if (estLinks.length) {
      defs.append("pattern")
        .attr("id", "sk-hatch").attr("patternUnits", "userSpaceOnUse")
        .attr("width", 7).attr("height", 7).attr("patternTransform", "rotate(45)")
        .append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 7)
        .attr("stroke", T["ink-3"]).attr("stroke-width", 2.5);
      svg.append("g").attr("fill", "none").selectAll("path").data(estLinks).join("path")
        .attr("class", "sk-link-hatch")
        .attr("d", d3.sankeyLinkHorizontal())
        .attr("stroke", "url(#sk-hatch)")
        .attr("stroke-width", d => Math.max(1.5, d.width))
        .attr("pointer-events", "none");
    }

    /* two-way marker: a small badge at the ribbon's midpoint */
    const netG = svg.append("g").attr("class", "sk-net").attr("pointer-events", "none")
      .selectAll("g").data(graph.links.filter(l => l.netted)).join("g")
      .attr("transform", d => `translate(${(d.source.x1 + d.target.x0) / 2},${(d.y0 + d.y1) / 2})`);
    netG.append("circle").attr("r", 9);
    netG.append("text").attr("dy", "0.36em").attr("text-anchor", "middle").text("⇄");

    /* node bars */
    const nodeG = svg.append("g").selectAll("g").data(graph.nodes).join("g")
      .attr("class", "sk-node")
      .style("cursor", "pointer")
      .attr("tabindex", 0)
      .attr("aria-label", d => `${d.label}: ${fmt(d.value)}`)
      .on("click", (ev, d) => {
        if (APP.idx.nodeById[d.id]) State.set({ node: d.id, layer: null });
        else if (U.layerOf(d._layerId)) State.set({ layer: d._layerId, node: null });
      });
    nodeG.append("rect")
      .attr("x", d => d.x0).attr("y", d => d.y0)
      .attr("height", d => Math.max(3, d.y1 - d.y0))
      .attr("width", d => d.x1 - d.x0)
      .attr("fill", d => colOf(d))
      .attr("rx", 2);

    /* labels: first column outside left, last column outside right,
       middle columns to the right of their bar on a halo */
    const colGap = maxDepth ? (graph.nodes.find(n => n.depth === 1) || { x0: W }).x0 - LBL : W;
    const wrapWords = (text, maxCh, maxLines) => {
      const words = text.split(/\s+/); const lines = [];
      let cur = "";
      for (const w of words) {
        if (!cur) cur = w;
        else if ((cur + " " + w).length <= maxCh) cur += " " + w;
        else { lines.push(cur); cur = w; }
      }
      if (cur) lines.push(cur);
      if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "") + "\u2026"; }
      return lines.map(l => l.length > maxCh ? l.slice(0, maxCh - 1) + "\u2026" : l);
    };
    const labelData = graph.nodes.map(d => {
      const first = d.depth === 0, last = d.depth === maxDepth && maxDepth > 0;
      const anchor = first ? "end" : "start";
      const x = first ? d.x0 - 8 : d.x1 + 8;
      const y = (d.y0 + d.y1) / 2;
      const room = first || last ? LBL - 14 : Math.min(230, colGap - 30);
      const maxCh = Math.max(12, Math.floor(room / 7.1));
      const lines = wrapWords(d.label, maxCh, 2);
      return { d, x, y, anchor, lines, h: lines.length * 15 + 14, origY: y, mid: !first && !last };
    });
    /* collision pass per column: down from the top, then up off the floor */
    const top = TOP + 10, bot = H - 14;
    const byCol = d3.group(labelData, l => l.d.depth);
    for (const group of byCol.values()) {
      group.sort((a, b) => a.y - b.y);
      let prev = null;
      for (const cur of group) { cur.y = Math.max(cur.y, prev ? prev.y + (prev.h + cur.h) / 2 + 3 : -Infinity, top + cur.h / 2 - 8); prev = cur; }
      let next = null;
      for (let i = group.length - 1; i >= 0; i--) { const cur = group[i]; cur.y = Math.min(cur.y, next ? next.y - (next.h + cur.h) / 2 - 3 : Infinity, bot - cur.h / 2 + 8); next = cur; }
    }
    const labels = svg.append("g").attr("class", "sk-labels").selectAll("g").data(labelData).join("g")
      .attr("class", d => `sk-node-label${d.mid ? " mid" : ""}`).attr("pointer-events", "none");
    labels.filter(d => Math.abs(d.y - d.origY) > 4).append("line").attr("class", "sk-leader")
      .attr("x1", d => d.anchor === "start" ? d.d.x1 + 1 : d.d.x0 - 1).attr("y1", d => d.origY)
      .attr("x2", d => d.anchor === "start" ? d.x - 2 : d.x + 2).attr("y2", d => d.y);
    /* block of text lines centred on y: name lines, then the value */
    const lt = labels.append("text").attr("text-anchor", d => d.anchor);
    lt.each(function (d) {
      const t = d3.select(this);
      const y0 = d.y - d.h / 2 + 11;
      d.lines.forEach((ln, i) => t.append("tspan").attr("class", "lbl").attr("x", d.x).attr("y", y0 + i * 15).text(ln));
      t.append("tspan").attr("class", "val").attr("x", d.x).attr("y", y0 + d.lines.length * 15).text(fmt(d.d.value));
    });

    wrap.innerHTML = "";
    wrap.appendChild(svg.node());
    wrap.parentElement.classList.toggle("sk-scrolls", W > (wrap.clientWidth || 0) + 2);

    /* ── Hover tooltips ─────────────────────────────────────── */
    const chart = wrap.parentElement;
    const tip = U.$("#sk-tip") || chart.appendChild(document.createElement("div"));
    const place = ev => {
      const r = chart.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = ev.clientX - r.left + 16;
      if (left + tw > r.width - 4) left = ev.clientX - r.left - tw - 16;
      tip.style.left = Math.max(4, Math.min(left, r.width - tw - 4)) + "px";
      let tp = ev.clientY - r.top - th - 12;
      if (tp < 4) tp = ev.clientY - r.top + 18;
      tip.style.top = Math.max(4, Math.min(tp, r.height - th - 4)) + "px";
    };
    const show = (ev, html) => { tip.innerHTML = html; tip.classList.add("visible"); place(ev); };
    const word = M.struct ? ["links out to", "links in from"] : key === "capex_usd" ? ["pays out", "receives"] : ["supplies", "receives"];

    function highlightNode(ev, d) {
      wrap.classList.add("hover-active");
      linkSel.classed("hl", l => l.source === d || l.target === d);
      const connected = new Set([d.index]);
      graph.links.forEach(l => {
        if (l.source === d) connected.add(l.target.index);
        if (l.target === d) connected.add(l.source.index);
      });
      nodeG.classed("hl", n => connected.has(n.index));
      const inn = graph.links.filter(l => l.target === d), out = graph.links.filter(l => l.source === d);
      const sumIn = d3.sum(inn, l => l.value), sumOut = d3.sum(out, l => l.value);
      const lay = U.layerOf(d._layerId);
      show(ev, `<b>${U.esc(d.label)}</b>${lay ? `<span class="t-sub">${U.esc(SEGMENT_LABEL[U.segment(lay.kind)] || "")}</span>` : ""}
        ${out.length ? `<span class="t-row"><span>${U.esc(word[0][0].toUpperCase() + word[0].slice(1))}</span><span class="t-num">${fmt(sumOut)}</span></span><span class="t-note">to ${Sankey._plural(out.length, "group")}</span>` : ""}
        ${inn.length ? `<span class="t-row"><span>${U.esc(word[1][0].toUpperCase() + word[1].slice(1))}</span><span class="t-num">${fmt(sumIn)}</span></span><span class="t-note">from ${Sankey._plural(inn.length, "group")}</span>` : ""}
        <span class="t-foot">Click to open its panel</span>`);
    }
    function highlightLink(ev, l) {
      wrap.classList.add("hover-active");
      linkSel.classed("hl", x => x === l);
      nodeG.classed("hl", n => n === l.source || n === l.target);
      const deals = Sankey._deals(l._raw, l.source._layerId, M, 3);
      show(ev, `<b>${U.esc(l.source.label)} <span class="t-arr">→</span> ${U.esc(l.target.label)}</b>
        <span class="t-big">${fmt(l.value)}</span>
        ${l.netted ? `<span class="t-note t-net">⇄ Two-way: ${fmt(l.gross)} went this way and ${fmt(l.against)} came back, so the ribbon shows the ${fmt(l.value)} difference.</span>` : ""}
        ${l.est ? `<span class="t-note">Includes our own estimates (hatched).</span>` : ""}
        ${deals.length ? `<span class="t-h">${M.struct ? "Examples" : (l.n > 1 ? `${l.n} deals, largest shown` : "The deal")}</span>${deals.map(x => `<span class="t-deal">${U.esc(x.a)} → ${U.esc(x.b)}: ${U.esc(x.what)}${x.year ? `, ${x.year}` : ""}${x.v ? `, <span class="t-num">${x.v}</span>${x.est ? " (est.)" : ""}` : ""} ${Sankey._gradeChip(x.conf)}</span>`).join("")}${l.n > deals.length ? `<span class="t-note">and ${l.n - deals.length} more</span>` : ""}` : ""}`);
    }
    function clearHighlight() {
      wrap.classList.remove("hover-active");
      linkSel.classed("hl", false);
      nodeG.classed("hl", false);
      tip.classList.remove("visible");
    }
    nodeG.on("mouseenter", highlightNode).on("mousemove", place).on("mouseleave", clearHighlight)
      .on("focus", function (ev, d) { const r = this.getBoundingClientRect(); highlightNode({ clientX: r.right, clientY: r.top + r.height / 2 }, d); })
      .on("blur", clearHighlight);
    linkSel.on("mouseenter", highlightLink).on("mousemove", place).on("mouseleave", clearHighlight);
  },

  /* ── Legend: colours, then the two marks used on ribbons ───── */
  _renderLegend(data, M, empty) {
    const el = U.$("#sk-legend");
    if (!el) return;
    const T = APP.tokens;
    if (empty) { el.innerHTML = ""; return; }
    const segs = Sankey._activeSegments(data.nodes.map(n => ({ ...n, _layerId: n.layer })));
    const marks = [];
    if (!M.struct && data.links.some(l => l.est)) marks.push(`<span class="sk-mark" title="At least one deal in this ribbon is our own estimate rather than a published figure"><i class="est"></i>includes our estimates</span>`);
    if (!M.struct && data.links.some(l => l.netted)) marks.push(`<span class="sk-mark" title="Money runs both ways between these two groups; the ribbon shows only the difference. Hover it to see both directions."><i class="net">⇄</i>two-way, difference shown</span>`);
    el.innerHTML = `<span class="sk-legend-l">Colour = part of the chain</span>` + Array.from(segs).map(([seg, label]) => {
      const col = T[`seg-${seg}`] || T["ink-3"];
      return `<span><i style="background:${col}"></i>${U.esc(label)}</span>`;
    }).join("") + (marks.length ? `<span class="sk-legend-sep"></span>${marks.join("")}` : "");
  },

  /* ── Loops removed for drawing ─────────────────────────────── */
  _renderDropped(el, data, M) {
    const fmt = Sankey._fmt(M);
    const dropped = data.dropped || [];
    if (!dropped.length) { el.innerHTML = ""; return; }
    const nodeMap = {};
    for (const n of data.nodes) nodeMap[n.id] = n.label;
    el.innerHTML = `<details class="sk-dropped"><summary>${Sankey._plural(dropped.length, "link")} left out of the drawing</summary>
      <p>This kind of diagram cannot draw a loop. Where groups feed each other in a circle, the smallest link in the loop is left out of the picture. It is still in the data and in each group's panel.</p>
      <ul>${dropped.map(d => `<li>${U.esc(nodeMap[d.s] || d.s)} → ${U.esc(nodeMap[d.t] || d.t)}: <span class="num">${fmt(d.v)}</span></li>`).join("")}</ul>
    </details>`;
  },

  /* ── The biggest flows, as a ranked list ───────────────────── */
  TOP_N: 8,
  _showAll: false,
  _renderTopRibbons(el, data, M, key) {
    const fmt = Sankey._fmt(M);
    const all = [...data.links].sort((a, b) => b.v - a.v);
    if (!all.length) { el.innerHTML = ""; return; }
    const links = Sankey._showAll ? all : all.slice(0, Sankey.TOP_N);
    const total = all.reduce((s, l) => s + l.v, 0) || 1;
    const max = all[0].v || 1;
    const nodeMap = {}, nodeLayerMap = {};
    for (const n of data.nodes) { nodeMap[n.id] = n.label; nodeLayerMap[n.id] = n.layer; }
    const T = APP.tokens;
    const colFor = id => { const lay = U.layerOf(nodeLayerMap[id]); return T[`seg-${lay ? U.segment(lay.kind) : "other"}`] || T["ink-3"]; };
    const top3 = all.slice(0, 3).reduce((s, l) => s + l.v, 0);
    el.innerHTML = `<section class="sk-top">
      <div class="sk-top-head">
        <h3>The biggest flows</h3>
        <p>${all.length > 3 ? `The three largest carry <b>${Math.round(100 * top3 / total)}%</b> of the ${fmt(total)} drawn above.` : `${fmt(total)} drawn above in total.`}${M.struct ? "" : " Each row lists the deals behind it."}</p>
      </div>
      <ol class="sk-top-list">${links.map((l, i) => {
        const cs = colFor(l.s), ct = colFor(l.t);
        const deals = Sankey._deals(l, nodeLayerMap[l.s], M, 3);
        const notes = [];
        if (l.netted) notes.push(`<span class="flow-note" title="Money runs both ways between these groups; only the difference is drawn">⇄ two-way: ${fmt(l.gross)} this way, ${fmt(l.against)} back</span>`);
        if (l.est) notes.push(`<span class="flow-note">includes our estimates</span>`);
        return `<li data-s="${U.esc(l.s)}" data-t="${U.esc(l.t)}" tabindex="0" role="button">
          <span class="flow-rank">${i + 1}</span>
          <div class="flow-main">
            <div class="flow-names"><i class="flow-dot" style="background:${cs}"></i>${U.esc(nodeMap[l.s] || l.s)} <span class="flow-arrow">→</span> <i class="flow-dot" style="background:${ct}"></i>${U.esc(nodeMap[l.t] || l.t)}</div>
            ${deals.length ? `<ul class="flow-edges">${deals.map(d => `<li><span class="flow-deal">${U.esc(d.a)} → ${U.esc(d.b)}: ${U.esc(d.what)}${d.year ? `, ${d.year}` : ""}</span>${d.v ? `<span class="flow-dv">${d.v}${d.est ? " est." : ""}</span>` : ""}${Sankey._gradeChip(d.conf)}</li>`).join("")}${l.n > deals.length ? `<li class="flow-more">and ${l.n - deals.length} more ${M.struct ? "links" : "deals"}</li>` : ""}</ul>` : ""}
            ${notes.join("")}
          </div>
          <div class="flow-num">
            <span class="flow-val">${fmt(l.v)}</span>
            <span class="flow-share" title="${Math.round(100 * l.v / total)}% of everything drawn"><i style="width:${(100 * l.v / max).toFixed(1)}%;background:${cs}"></i></span>
            <span class="flow-pct">${Math.round(100 * l.v / total)}% of total</span>
          </div>
        </li>`;
      }).join("")}</ol>
      ${all.length > Sankey.TOP_N ? `<button type="button" class="btn-quiet sk-more">${Sankey._showAll ? "Show the top " + Sankey.TOP_N : `Show all ${all.length} flows`}</button>` : ""}
    </section>`;
    const more = U.$(".sk-more", el);
    if (more) U.on(more, "click", () => { Sankey._showAll = !Sankey._showAll; Sankey._renderTopRibbons(el, data, M, key); });
    const open = li => {
      const sid = li.getAttribute("data-s"), tid = li.getAttribute("data-t");
      const target = APP.idx.nodeById[sid] || APP.idx.nodeById[tid];
      if (target) State.set({ node: target.id, layer: null });
      else {
        const layId = nodeLayerMap[sid] || nodeLayerMap[tid];
        if (layId && U.layerOf(layId)) State.set({ layer: layId, node: null });
      }
    };
    U.$$(".sk-top-list > li[data-s]", el).forEach(li => {
      U.on(li, "click", () => open(li));
      U.on(li, "keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(li); } });
    });
  },
};
/* Cost-of-capital view: FRED yields and spreads (rates.json), AI credit series from capital-layer nodes, warning levels. */
const Rates = {
  data: null,
  FAIR: [5.1, 5.4],                         /* the author's fair-value range for the US 10-year */
  EP: ["2026-06-18", "2026-07-29"],         /* the episode window marked on the charts */
  FOMC: "2026-09-16",
  GRADE: { A: "official filing or dataset", B: "company or broker statement", C: "press or market data", D: "our estimate" },
  _chip(c) { c = c || "D"; return `<span class="grade grade-${U.esc(c)}" title="Source grade ${U.esc(c)}: ${U.esc(Rates.GRADE[c] || "")}">${U.esc(c)}</span>`; },
  _tipEl: null,
  /* one floating tooltip for the whole view */
  _tip() {
    if (Rates._tipEl && document.body.contains(Rates._tipEl)) return Rates._tipEl;
    const t = document.createElement("div"); t.className = "rt-tip"; t.setAttribute("role", "status");
    document.body.appendChild(t); Rates._tipEl = t; return t;
  },
  _showTip(ev, html) {
    const t = Rates._tip(); t.innerHTML = html; t.classList.add("visible");
    const tw = t.offsetWidth, th = t.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let x = ev.clientX + 14; if (x + tw > vw - 6) x = ev.clientX - tw - 14;
    let y = ev.clientY - th - 12; if (y < 6) y = ev.clientY + 16;
    t.style.left = Math.max(6, Math.min(x, vw - tw - 6)) + "px";
    t.style.top = Math.max(6, Math.min(y, vh - th - 6)) + "px";
  },
  _hideTip() { if (Rates._tipEl) Rates._tipEl.classList.remove("visible"); },

  async render() {
    const el = U.$("#view-rates");
    if (!Rates.data) { try { const r = await fetch(Data.url("rates.json"), { cache: "no-cache" }); Rates.data = r.ok ? await r.json() : { series: {} }; } catch (e) { Rates.data = { series: {} }; } }
    const S = Rates.data.series || {}; const T = APP.tokens;
    if (!Object.keys(S).length) { el.innerHTML = `<div class="container"><p class="note">No interest-rate data in this build yet.</p></div>`; return; }
    const g = (id) => S[id];
    const latest = (id) => { const s = g(id); return s && s.latest ? s.latest : null; };
    const at = (id, daysBack) => { const s = g(id); if (!s || !s.points.length) return null; const target = new Date(s.latest[0]); target.setDate(target.getDate() - daysBack); const iso = target.toISOString().slice(0, 10); let best = null; for (const p of s.points) { if (p[0] <= iso) best = p; else break; } return best; };
    const tile = (id, label, unit, opts) => {
      const s = g(id); if (!s) return "";
      const l = s.latest; const m3 = at(id, 91); const y1 = at(id, 365);
      /* USD_m (public debt) is a level, not a rate: show it in dollars and its change in % */
      const lvl = unit === "index" || unit === "usd_m";
      const fmt = v => unit === "bp" ? `${Math.round(v * 100)} bp` : unit === "index" ? U.num(v, 0) : unit === "usd_m" ? `$${U.num(v, 0)}m` : `${U.num(v, 2)}%`;
      const dfmt = (a, b) => a && b ? (() => { const d = lvl ? (a[1] / b[1] - 1) * 100 : (a[1] - b[1]) * 100; const cls = d > 0 ? "up" : d < 0 ? "down" : ""; const txt = lvl ? `${d >= 0 ? "+" : ""}${U.num(d, 1)}%` : `${d >= 0 ? "+" : ""}${U.num(d, 0)} bp`; return `<span class="${cls}">${txt}</span>`; })() : "";
      const pts = s.points.filter(p => y1 ? p[0] >= y1[0] : true).map(p => [p[0], p[1]]);
      return `<div class="tile" title="${U.esc(s.label || label)}: latest ${U.esc(fmt(l[1]))} on ${U.esc(l[0])}. Change over 3 months and 1 year; the line shows the last year. Source: FRED series ${U.esc(id)}."><div class="l">${U.esc(label || s.label)}</div><div class="v">${fmt(l[1])}</div><div class="d"><span>3m ${dfmt(l, m3)}</span><span>1y ${dfmt(l, y1)}</span></div>${Widgets.sparkline(pts, opts && opts.colour ? opts.colour : T.accent)}<div class="as">${l[0]} · FRED ${U.esc(id)}</div></div>`;
    };
    const fair = Rates.FAIR;
    const ten = latest("DGS10");
    const tp = latest("THREEFYTP10");
    const verdict = ten ? (ten[1] >= fair[0]
      ? `The US 10-year yield is <b>${U.num(ten[1], 2)}%</b>, inside or above the author's fair-value range of ${fair[0]} to ${fair[1]}%.`
      : `The US 10-year yield is <b>${U.num(ten[1], 2)}%</b>, ${U.num((fair[0] - ten[1]) * 100, 0)} bp below the bottom of the author's fair-value range (${fair[0]} to ${fair[1]}%).`) : "";

    const aiSer = await Data.ensureSeries();
    const igShare = aiSer.us_ig_market && aiSer.us_ig_market.ai_share_of_ig_issuance_pct ? aiSer.us_ig_market.ai_share_of_ig_issuance_pct : null;
    const igShareLast = igShare && igShare.points.length ? igShare.points[igShare.points.length - 1] : null;
    const debtTotal = aiSer.hyperscaler_debt && aiSer.hyperscaler_debt.total_hyperscaler_debt_usd_bn ? aiSer.hyperscaler_debt.total_hyperscaler_debt_usd_bn : null;
    const debtLast = debtTotal && debtTotal.points.length ? debtTotal.points[debtTotal.points.length - 1] : null;
    const headlineCards = [
      ten ? { label: "US 10-year Treasury yield", value: `${U.num(ten[1], 2)}%`, sub: `Author's fair-value range ${fair[0]} to ${fair[1]}%`, date: ten[0], grade: "A", src: "FRED DGS10", status: ten[1] >= fair[0] ? "warn" : ten[1] >= fair[0] - 0.15 ? "near" : "ok",
        tip: "The interest rate the US government pays to borrow for 10 years. It is the floor under almost every long-term loan, including those that fund data centres." } : null,
      tp ? { label: "Term premium", value: `${Math.round(tp[1] * 100)} bp`, sub: "Extra yield for lending long (Kim-Wright model)", date: tp[0], grade: "A", src: "FRED THREEFYTP10", status: tp[1] >= 0.80 ? "warn" : "ok",
        tip: "The extra return investors demand for tying money up for 10 years rather than rolling short loans. It rises when the market worries about a flood of long-dated borrowing. The author watches the 80 bp level." } : null,
      igShareLast ? { label: "AI share of US investment-grade bond sales", value: `~${U.num(igShareLast[1], 0)}%`, sub: igShare.points.length > 1 ? `from ~${U.num(igShare.points[0][1], 0)}% in ${igShare.points[0][0]}` : "H1 2026", date: igShareLast[0], grade: igShareLast[3] || "D", src: "SIFMA, Bloomberg", status: igShareLast[1] >= 15 ? "warn" : "ok",
        tip: "How much of all new high-quality US corporate bond issuance comes from AI-related borrowers. The author watches the 15% level." } : null,
      debtLast ? { label: "Hyperscaler debt", value: `$${U.num(debtLast[1], 0)}bn`, sub: debtTotal.points.length > 1 ? `from ~$${U.num(debtTotal.points[0][1], 0)}bn in ${debtTotal.points[0][0]}` : "long-term debt of the big cloud builders", date: debtLast[0], grade: debtLast[3] || "D", src: "company filings, Bloomberg", status: debtLast[1] >= 400 ? "warn" : "ok",
        tip: "Combined long-term debt of the companies building AI data centres at scale (Alphabet, Amazon, Microsoft, Meta, Oracle, CoreWeave). The author watches the $400bn level." } : null,
    ].filter(Boolean);
    const statusWord = { warn: "past the watched level", near: "close to the watched level", ok: "below the watched level" };
    const headlineHtml = headlineCards.length ? `<section class="rates-headline">
      <div class="rates-headline-top"><h3 class="rates-headline-q">Is the buildout pushing the cost of money up?</h3><p class="rates-verdict">${verdict}</p></div>
      <div class="rates-headline-cards">${headlineCards.map(c => `<div class="rates-hl-card rates-hl-${c.status}" tabindex="0" data-tip="${U.esc(c.tip)}">
        <div class="rates-hl-label">${U.esc(c.label)}</div>
        <div class="rates-hl-value">${c.value}</div>
        <div class="rates-hl-sub">${U.esc(c.sub)}</div>
        <div class="rates-hl-foot"><span class="rates-hl-status">${statusWord[c.status]}</span><span>${U.esc(c.date)} ${Rates._chip(c.grade)}</span></div>
      </div>`).join("")}</div>
      <p class="rates-hl-key">The coloured edge shows each reading against the level the author watches: <span class="k k-warn">past it</span> <span class="k k-near">close</span> <span class="k k-ok">below it</span>. Hover a card for what it means.</p>
    </section>` : "";

    /* Denmark strip */
    const dkPol = latest("ECBDFR");
    const dk10 = latest("IRLTLT01DKM156N");
    const dkVarSer = aiSer.dk_mortgage_rates && aiSer.dk_mortgage_rates.variable_rate_share_new_loans_pct;
    const dkVarLast = dkVarSer && dkVarSer.points.length ? dkVarSer.points[dkVarSer.points.length - 1] : null;
    const dnCd = aiSer.dk_mortgage_rates && aiSer.dk_mortgage_rates.dn_cd_rate_pct;
    const dnCdLast = dnCd && dnCd.points.length ? dnCd.points[dnCd.points.length - 1] : null;
    const dkCards = [
      dnCdLast ? { label: "Nationalbanken policy rate (CD rate)", value: `${U.num(dnCdLast[1], 2)}%`, date: dnCdLast[0], grade: dnCdLast[3] || "A" } : (dkPol ? { label: "ECB deposit rate", value: `${U.num(dkPol[1], 2)}%`, date: dkPol[0], grade: "A" } : null),
      dk10 ? { label: "Danish 10-year government yield", value: `${U.num(dk10[1], 2)}%`, date: dk10[0], grade: "A" } : null,
      dkVarLast ? { label: "Share of new mortgages at variable rates", value: `${U.num(dkVarLast[1], 0)}%`, date: dkVarLast[0], grade: dkVarLast[3] || "B" } : null,
    ].filter(Boolean);
    const dkStrip = dkCards.length ? `<section class="rates-dk-strip"><div class="rates-dk-title">Denmark <span>the author's home market: how global rates reach Danish households</span></div><div class="rates-dk-cards">${dkCards.map(c => `<div class="rates-dk-card"><div class="rates-dk-label">${U.esc(c.label)}</div><div class="rates-dk-value">${c.value}</div><div class="rates-dk-date">${U.esc(c.date)} ${Rates._chip(c.grade)}</div></div>`).join("")}</div></section>` : "";

    const shownTiles = ["DGS10", "DGS30", "DGS2", "DFII10", "T10YIE", "EFFR", "ECBDFR", "IRLTLT01DKM156N", "IRLTLT01DEM156N", "BAMLC0A0CM", "BAMLC0A4CBBB", "BAMLH0A0HYM2", "BAMLC0A0CMEY", "BAMLC0A1CAAAEY", "BAMLCC0A0CMTRIV"];
    const nSeries = Object.keys(S).length;

    el.innerHTML = `<div class="container rates-view">
      <header class="rates-head">
        <h2>The cost of capital</h2>
        <p class="rates-lede">Data centres, chips and power plants are paid for with borrowed money as well as profits. The interest rate on that money decides which projects pencil out. This page tracks the price of borrowing for the AI buildout: <b>government bond yields</b>, the floor under every loan; <b>credit spreads</b>, the extra that companies pay on top; and <b>AI-specific borrowing</b>.</p>
      </header>
      <div class="rates-gloss">
        <div><b>Yield</b><span>The annual interest an investor earns for lending, in %. Higher yields mean costlier borrowing.</span></div>
        <div><b>Spread</b><span>The extra yield a company pays over the government for the same loan. It widens when lenders get nervous.</span></div>
        <div><b>bp, basis point</b><span>One hundredth of a percentage point: 100 bp = 1%.</span></div>
        <div><b>Rating</b><span>AAA is the safest borrower, then AA, A, BBB. Below BBB is high yield ("junk").</span></div>
      </div>
      <section class="rates-live" id="rates-live" hidden></section>
      ${headlineHtml}

      <div class="chart rates-chart" id="rates-chart-yields">
        <div class="rates-chart-h"><h3>US government borrowing costs since 2018</h3>
        <p>US Treasury yields since 2018, weekly. <b>How to read it:</b> each line is the yield on a US government bond of a given length. The amber band is the author's fair-value range for the 10-year (${fair[0]} to ${fair[1]}%); if the 10-year line enters it, that view is confirmed. The grey window marks 18 June to 29 July 2026, an episode the author's analysis flags; the dotted line is the Federal Reserve meeting of 16 September 2026.</p></div>
      </div>
      <div class="chart rates-chart" id="rates-chart-credit">
        <div class="rates-chart-h"><h3>The extra premium companies pay to borrow</h3>
        <p>Credit spreads by rating since September 2023, weekly, in basis points. <b>How to read it:</b> a spread is the extra yield a company pays over the US government. Lines rising together would mean lenders demanding more to fund corporate borrowing, including AI. Compare the right-hand end of each line with its own past.</p></div>
      </div>
      <div class="chart rates-chart" id="rates-chart-spread-buckets">
        <div class="rates-chart-h"><h3>Where the AI builders borrow: spread by credit rating today</h3>
        <p>The extra yield over US government bonds paid by each rating group, latest reading. Under each bar is the AI builder whose credit rating falls in that group, so the bar is roughly what the market charges that company type. Mapping by the author: Microsoft AAA, Alphabet and Amazon AA, Meta A, Oracle BBB, CoreWeave high yield.</p></div>
      </div>

      <h3 class="section-h">AI borrowing signals</h3>
      <p class="rates-sec-p">Specific signs of how much the buildout leans on debt, and what lenders charge the most exposed names.</p>
      <div id="rates-ai"></div>
      ${dkStrip}
      <h3 class="section-h">Warning levels the author watches</h3>
      <div id="rates-triggers"></div>

      <details class="rates-all">
        <summary>All ${nSeries} rate series, latest readings <span class="sum-sub">government, policy, curve and credit, from FRED</span></summary>
        <div class="rates-all-body">
          <div class="section-h">Government and policy rates</div>
          <div class="tiles">${tile("DGS10", "US 10-year Treasury", "pct")}${tile("DGS30", "US 30-year Treasury", "pct")}${tile("DGS2", "US 2-year Treasury", "pct")}${tile("DFII10", "US 10-year real yield (after inflation, TIPS)", "pct")}${tile("T10YIE", "10-year inflation expected by markets", "pct")}${tile("EFFR", "Effective fed funds rate", "pct")}${tile("ECBDFR", "ECB deposit rate", "pct")}${tile("IRLTLT01DKM156N", "Denmark 10-year (monthly)", "pct")}${tile("IRLTLT01DEM156N", "Germany 10-year (monthly)", "pct")}</div>
          <div class="section-h">Corporate credit</div>
          <div class="tiles">${tile("BAMLC0A0CM", "Investment-grade spread", "bp", { colour: T["seg-tools"] })}${tile("BAMLC0A4CBBB", "BBB spread", "bp", { colour: T["seg-tools"] })}${tile("BAMLH0A0HYM2", "High-yield spread", "bp", { colour: T["seg-tools"] })}${tile("BAMLC0A0CMEY", "Investment-grade yield", "pct", { colour: T["seg-tools"] })}${tile("BAMLC0A1CAAAEY", "AAA yield", "pct", { colour: T["seg-tools"] })}${tile("BAMLCC0A0CMTRIV", "Investment-grade total-return index", "index", { colour: T["seg-tools"] })}</div>
          ${Rates.extraTiles(tile, shownTiles)}
          <p class="rates-src">Spreads are ICE BofA option-adjusted spreads (OAS), which strip out the value of call features. Each tile shows the change over 3 months and 1 year and a one-year line. Source: Federal Reserve Bank of St Louis (FRED), as of ${U.esc(Rates.data.as_of || "")} ${Rates._chip("A")}.</p>
        </div>
      </details>
    </div>`;

    U.$$(".rates-hl-card", el).forEach(c => {
      U.on(c, "mouseenter", ev => Rates._showTip(ev, `<span class="t-note">${U.esc(c.getAttribute("data-tip"))}</span>`));
      U.on(c, "mousemove", ev => Rates._showTip(ev, `<span class="t-note">${U.esc(c.getAttribute("data-tip"))}</span>`));
      U.on(c, "mouseleave", Rates._hideTip);
      U.on(c, "focus", () => { const r = c.getBoundingClientRect(); Rates._showTip({ clientX: r.left + 20, clientY: r.top }, `<span class="t-note">${U.esc(c.getAttribute("data-tip"))}</span>`); });
      U.on(c, "blur", Rates._hideTip);
    });

    Rates.lineChart(U.$("#rates-chart-yields"), [["DGS30", "30-year", T["seg-consumers"]], ["DGS10", "10-year", T["seg-materials"]], ["DGS2", "2-year", T["ink-3"]], ["DFII10", "10-year real", T["seg-silicon"]]], "pct", { band: fair, bandLabel: "Author's fair-value range, 10-year", src: `Source: US Treasury via FRED ${Rates._chip("A")}; real yield from TIPS (inflation-protected bonds).` });
    Rates.lineChart(U.$("#rates-chart-credit"), [["BAMLH0A0HYM2", "High yield", T["seg-infra"]], ["BAMLC0A4CBBB", "BBB", T["seg-tools"]], ["BAMLC0A0CM", "Investment grade", T["seg-materials"]], ["BAMLC0A3CA", "A", T["seg-operators"]], ["BAMLC0A2CAA", "AA", T["seg-chips"]], ["BAMLC0A1CAAA", "AAA", T["seg-silicon"]]], "bp", { src: `Source: ICE BofA option-adjusted spreads via FRED ${Rates._chip("A")}.` });
    Rates.spreadBuckets(U.$("#rates-chart-spread-buckets"));
    Rates.renderLive();
    Rates.aiCredit(U.$("#rates-ai"));
    Rates.triggers(U.$("#rates-triggers"), { ten: ten ? ten[1] : null, dk: dk10 ? dk10[1] : null, ecb: dkPol ? dkPol[1] : null });
  },

  /* ── Live strip: market signals that move during the day (live.json via Live) ── */
  LIVE_KEYS: ["us3m", "us5y", "us10y", "us30y", "hyg", "lqd", "vix", "dxy"],
  LIVE_INFO: {
    us3m: ["3-month T-bill", "What the US government pays to borrow for three months; tracks the Fed's policy rate."],
    us5y: ["5-year Treasury", "US government five-year borrowing cost."],
    us10y: ["10-year Treasury", "The benchmark long-term rate: the floor under most long loans, including data-centre financing."],
    us30y: ["30-year Treasury", "The longest US government bond; most sensitive to worries about heavy long-term borrowing."],
    hyg: ["High-yield bonds", "HYG, an exchange-traded fund of riskier corporate bonds. Its price falls when lenders demand more from weaker borrowers."],
    lqd: ["Quality bonds", "LQD, an exchange-traded fund of high-quality corporate bonds, the market most AI builders borrow in."],
    vix: ["Volatility (VIX)", "The stock market's expected swings over the next month. Higher means more nervous markets."],
    dxy: ["US dollar index", "The dollar against major currencies. A strong dollar tightens global funding."],
  },
  renderLive() {
    const el = U.$("#rates-live"); if (!el) return;
    if (typeof Live === "undefined" || !Live.ready) { el.hidden = true; return; }
    const cells = Rates.LIVE_KEYS.map(k => Live.market(k)).filter(Boolean);
    if (!cells.length) { el.hidden = true; return; }
    const ten = Live.market("us10y"), fair = Rates.FAIR;
    const tenLine = ten ? (ten.v >= fair[0] && ten.v <= fair[1]
      ? `Right now the 10-year is <b class="live-num">${ten.v.toFixed(2)}%</b>, inside the author's fair-value range of ${fair[0]} to ${fair[1]}%.`
      : ten.v > fair[1] ? `Right now the 10-year is <b class="live-num">${ten.v.toFixed(2)}%</b>, above the author's fair-value range of ${fair[0]} to ${fair[1]}%.`
      : `Right now the 10-year is <b class="live-num">${ten.v.toFixed(2)}%</b>, ${Math.round((fair[0] - ten.v) * 100)} bp below the author's fair-value range.`) : "";
    el.hidden = false;
    el.innerHTML = `<div class="rates-live-head"><span class="rates-live-k">${Live.dot()}Live markets</span><span class="rates-live-ago">updated <span class="live-ago">${Live.ago()}</span> · Yahoo Finance, some prices delayed 15 to 20 min ${Rates._chip("C")}</span></div>
      <p class="rates-live-p">${tenLine} The charts below use the end-of-day history built on ${U.esc(Rates.data.as_of || "")}; this strip moves during the day. Yields show today's change in basis points, prices in %.</p>
      <div class="rates-live-grid">${cells.map(mk => {
        const info = Rates.LIVE_INFO[mk.key] || [mk.label, ""];
        const h = Live.history(mk.key);
        return `<div class="rates-live-cell" title="${U.esc(mk.label)}: ${U.esc(info[1])}">
          <div class="rl-l">${U.esc(info[0])}</div>
          <div class="rl-v live-num">${Live.marketValue(mk)}</div>
          <div class="rl-c">${Live.marketChg(mk)}</div>
          ${h && h.length > 1 ? Live.spark(h, 96, 22) : ""}
        </div>`;
      }).join("")}</div>`;
  },

  extraTiles(tile, shown) {
    const S = Rates.data.series || {}; const T = APP.tokens; const rest = Object.keys(S).filter(k => !shown.includes(k));
    if (!rest.length) return "";
    const groups = {}; for (const k of rest) (groups[S[k].group || "extra"] = groups[S[k].group || "extra"] || []).push(k);
    const unitOf = k => S[k].unit === "index" ? "index" : S[k].unit === "USD_m" ? "usd_m" : (/OAS|spread/i.test(S[k].label) || (/^BAMLC\d|^BAMLH/.test(k) && !/EY$/.test(k) && !/TRIV$/.test(k))) ? "bp" : "pct";
    return Object.entries(groups).map(([g, keys]) => `<div class="section-h">${g === "credit" ? "Credit by rating and maturity" : g === "rates" ? "Yield curve, real rates and term premium" : "Other series"}</div><div class="tiles">${keys.map(k => tile(k, S[k].label, unitOf(k), { colour: g === "credit" ? T["seg-tools"] : T.accent })).join("")}</div>`).join("");
  },

  /* Multi-line time chart: direct end labels, crosshair tooltip, sized to its card */
  lineChart(wrap, spec, unit, opts) {
    if (!window.d3) { wrap.insertAdjacentHTML("beforeend", `<p class="note">Chart library did not load.</p>`); return; }
    const S = Rates.data.series; const T = APP.tokens;
    const series = spec.filter(([id]) => S[id]).map(([id, label, colour]) => ({ id, label, colour, pts: S[id].points.map(p => ({ d: new Date(p[0]), iso: p[0], v: unit === "bp" ? p[1] * 100 : p[1] })) }));
    if (!series.length) return;
    const fv = v => unit === "bp" ? `${Math.round(v)} bp` : `${v.toFixed(2)}%`;
    const box = document.createElement("div"); box.className = "rates-plot"; wrap.appendChild(box);
    const W = Math.max(320, Math.round(box.clientWidth || 900));
    const narrow = W < 560;
    const H = narrow ? 260 : 340;
    const m = { t: 14, r: narrow ? 64 : 140, b: 28, l: narrow ? 46 : 54 };
    const all = series.flatMap(s => s.pts);
    const x = d3.scaleTime().domain(d3.extent(all, d => d.d)).range([m.l, W - m.r]);
    let yExt = d3.extent(all, d => d.v); if (opts.band) yExt = [Math.min(yExt[0], opts.band[0] - 0.2), Math.max(yExt[1], opts.band[1] + 0.2)];
    const y = d3.scaleLinear().domain([unit === "bp" ? 0 : Math.floor(yExt[0]), unit === "bp" ? yExt[1] * 1.05 : Math.ceil(yExt[1])]).nice().range([H - m.b, m.t]);
    const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("width", W).attr("height", H).attr("role", "img")
      .attr("aria-label", `${series.map(s => `${s.label} ${fv(s.pts[s.pts.length - 1].v)}`).join(", ")}`);
    svg.append("g").attr("class", "grid").selectAll("line").data(y.ticks(narrow ? 4 : 6)).join("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", d => y(d)).attr("y2", d => y(d));
    if (unit === "pct" && y.domain()[0] < 0) svg.append("line").attr("class", "rates-zero").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(0)).attr("y2", y(0));
    const ep0 = new Date(Rates.EP[0]), ep1 = new Date(Rates.EP[1]);
    if (x(ep1) > m.l) svg.append("rect").attr("class", "rates-episode").attr("x", x(ep0)).attr("width", Math.max(3, x(ep1) - x(ep0))).attr("y", m.t).attr("height", H - m.t - m.b);
    if (opts.band) {
      svg.append("rect").attr("class", "rates-band").attr("x", m.l).attr("width", W - m.l - m.r).attr("y", y(opts.band[1])).attr("height", y(opts.band[0]) - y(opts.band[1]));
      svg.append("text").attr("class", "rates-band-l").attr("x", m.l + 8).attr("y", y(opts.band[1]) - 5).text(narrow ? "Fair-value range" : `Author's fair-value range for the 10-year, ${opts.band[0]} to ${opts.band[1]}%`);
    }
    const fomc = new Date(Rates.FOMC); if (fomc <= x.domain()[1]) svg.append("line").attr("class", "rates-fomc").attr("x1", x(fomc)).attr("x2", x(fomc)).attr("y1", m.t).attr("y2", H - m.b);
    const line = d3.line().x(d => x(d.d)).y(d => y(d.v)).defined(d => d.v != null);
    for (const s of series) svg.append("path").datum(s.pts).attr("class", "rates-line").attr("stroke", s.colour).attr("d", line);
    /* direct end labels, nudged apart */
    const ends = series.map(s => { const last = s.pts[s.pts.length - 1]; return { s, last, y: y(last.v), oy: y(last.v) }; }).sort((a, b) => a.y - b.y);
    const gapY = 14; for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + gapY);
    for (let i = ends.length - 2; i >= 0; i--) ends[i].y = Math.min(ends[i].y, ends[i + 1].y - gapY);
    const endG = svg.append("g").attr("class", "rates-ends");
    for (const e of ends) {
      const cx = x(e.last.d);
      endG.append("circle").attr("cx", cx).attr("cy", e.oy).attr("r", 3.2).attr("fill", e.s.colour);
      const t = endG.append("text").attr("x", cx + 8).attr("y", e.y).attr("dy", "0.35em");
      t.append("tspan").attr("class", "rates-end-v").attr("fill", e.s.colour).text(fv(e.last.v));
      t.append("tspan").attr("class", "rates-end-l").attr("dx", 5).text(narrow ? "" : e.s.label);
    }
    const span = (x.domain()[1] - x.domain()[0]) / 864e5;
    const tf = span > 1500 ? d3.timeFormat("%Y") : (d => d.getMonth() === 0 ? d3.timeFormat("%Y")(d) : d3.timeFormat("%b")(d));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(span > 1500 ? d3.timeYear.every(narrow ? 2 : 1) : (narrow ? 4 : 10)).tickFormat(tf).tickSizeOuter(0));
    svg.append("g").attr("class", "axis axis-y").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(narrow ? 4 : 6).tickFormat(d => unit === "bp" ? d + " bp" : d + "%").tickSize(0).tickPadding(8)).call(g => g.select(".domain").remove());
    /* hover: crosshair, dots, html tooltip */
    const hov = svg.append("g").style("display", "none").attr("pointer-events", "none");
    const hLine = hov.append("line").attr("class", "rates-cross").attr("y1", m.t).attr("y2", H - m.b);
    const hDots = series.map(s => hov.append("circle").attr("r", 4).attr("fill", s.colour).attr("stroke", T.surface).attr("stroke-width", 1.5));
    const move = ev => {
      const [mx] = d3.pointer(ev, svg.node());
      const d0 = x.invert(Math.max(m.l, Math.min(W - m.r, mx)));
      const rows = series.map((s, si) => {
        const i = Math.min(d3.bisector(p => p.d).left(s.pts, d0), s.pts.length - 1);
        const p = s.pts[i]; hDots[si].attr("cx", x(p.d)).attr("cy", y(p.v)); return { s, p };
      });
      hov.style("display", null); const px = x(rows[0].p.d); hLine.attr("x1", px).attr("x2", px);
      const ep = rows[0].p.iso >= Rates.EP[0] && rows[0].p.iso <= Rates.EP[1];
      Rates._showTip(ev, `<b>${U.esc(rows[0].p.iso)}</b>${rows.map(r => `<span class="t-row"><span><i style="background:${r.s.colour}"></i>${U.esc(r.s.label)}</span><span class="t-num">${fv(r.p.v)}</span></span>`).join("")}${ep ? `<span class="t-note">Inside the June to July 2026 window</span>` : ""}`);
    };
    svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).attr("fill", "transparent")
      .on("mousemove", move).on("touchmove", ev => { move(ev.touches ? ev.touches[0] : ev); }, { passive: true })
      .on("mouseleave", () => { hov.style("display", "none"); Rates._hideTip(); });
    box.appendChild(svg.node());
    wrap.insertAdjacentHTML("beforeend", `<div class="lgd">${series.map(s => `<span><i style="background:${s.colour}"></i>${U.esc(s.label)}</span>`).join("")}${opts.band ? `<span><i class="band" style="background:${T.warn}"></i>${U.esc(opts.bandLabel)}</span>` : ""}<span><i class="band" style="background:${T["ink-3"]}"></i>18 Jun to 29 Jul 2026</span><span><i class="dash"></i>Fed meeting, 16 Sep 2026</span></div>${opts.src ? `<p class="rates-src">${opts.src} Latest ${U.esc(series[0].pts[series[0].pts.length - 1].iso)}. Hover or touch the chart to read any date.</p>` : ""}`);
  },

  /* Rating-bucket spreads: horizontal bars with the AI builders mapped to each bucket */
  spreadBuckets(wrap) {
    if (!window.d3) return;
    const S = Rates.data.series; const T = APP.tokens;
    const buckets = [
      { id: "BAMLC0A1CAAA", label: "AAA", long: "AAA, safest", names: "Microsoft" },
      { id: "BAMLC0A2CAA", label: "AA", long: "AA", names: "Alphabet, Amazon" },
      { id: "BAMLC0A3CA", label: "A", long: "Single A", names: "Meta" },
      { id: "BAMLC0A4CBBB", label: "BBB", long: "BBB, lowest investment grade", names: "Oracle" },
      { id: "BAMLH0A0HYM2", label: "HY", long: "High yield (below BBB)", names: "CoreWeave" },
    ];
    const data = buckets.filter(b => S[b.id]).map(b => ({ ...b, v: S[b.id].latest[1] * 100, date: S[b.id].latest[0] }));
    if (!data.length) return;
    const box = document.createElement("div"); box.className = "rates-plot"; wrap.appendChild(box);
    const W = Math.max(320, Math.round(box.clientWidth || 700));
    const narrow = W < 560;
    const rowH = narrow ? 46 : 42;
    const m = { t: 6, r: 70, b: 24, l: narrow ? 118 : 230 };
    const H = m.t + m.b + rowH * data.length;
    const x = d3.scaleLinear().domain([0, d3.max(data, d => d.v) * 1.05]).nice().range([m.l, W - m.r]);
    const yb = d3.scaleBand().domain(data.map(d => d.label)).range([m.t, H - m.b]).padding(0.32);
    const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("width", W).attr("height", H).attr("role", "img")
      .attr("aria-label", data.map(d => `${d.label} ${Math.round(d.v)} bp`).join(", "));
    svg.append("g").attr("class", "grid").selectAll("line").data(x.ticks(narrow ? 3 : 6)).join("line").attr("x1", d => x(d)).attr("x2", d => x(d)).attr("y1", m.t).attr("y2", H - m.b);
    const colours = [T["seg-silicon"], T["seg-chips"], T["seg-operators"], T["seg-tools"], T["seg-infra"]];
    const rows = svg.selectAll(".rb").data(data).join("g").attr("class", "rb");
    rows.append("rect").attr("class", "rates-bar")
      .attr("x", m.l).attr("y", d => yb(d.label)).attr("width", d => Math.max(2, x(d.v) - m.l)).attr("height", yb.bandwidth())
      .attr("fill", (d, i) => colours[i]).attr("rx", 3);
    rows.append("text").attr("class", "rates-bar-v").attr("x", d => x(d.v) + 6).attr("y", d => yb(d.label) + yb.bandwidth() / 2).attr("dy", "0.35em").text(d => `${Math.round(d.v)} bp`);
    rows.append("text").attr("class", "rates-bar-l").attr("x", m.l - 10).attr("y", d => yb(d.label) + yb.bandwidth() / 2).attr("dy", narrow ? "-0.2em" : "-0.25em").attr("text-anchor", "end").text(d => narrow ? d.label : d.long);
    rows.append("text").attr("class", "rates-bar-n").attr("x", m.l - 10).attr("y", d => yb(d.label) + yb.bandwidth() / 2).attr("dy", "1.05em").attr("text-anchor", "end").text(d => d.names);
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(narrow ? 3 : 6).tickFormat(d => d + " bp").tickSizeOuter(0));
    rows.append("rect").attr("x", 0).attr("width", W).attr("y", d => yb(d.label) - 4).attr("height", yb.bandwidth() + 8).attr("fill", "transparent")
      .on("mousemove", (ev, d) => Rates._showTip(ev, `<b>${U.esc(d.long)}</b><span class="t-row"><span>Spread over US government</span><span class="t-num">${Math.round(d.v)} bp</span></span><span class="t-note">= ${U.num(d.v / 100, 2)} percentage points more interest a year. Rated here: ${U.esc(d.names)}.</span><span class="t-note">${U.esc(d.date)} · FRED ${U.esc(d.id)}</span>`))
      .on("mouseleave", Rates._hideTip);
    box.appendChild(svg.node());
    wrap.insertAdjacentHTML("beforeend", `<p class="rates-src">Source: ICE BofA option-adjusted spreads via FRED, ${U.esc(data[0].date)} ${Rates._chip("A")}. Company-to-rating mapping by the author ${Rates._chip("D")}.</p>`);
  },

  async aiCredit(wrap) {
    const ser = await Data.ensureSeries(); const T = APP.tokens;
    if (!APP.evidence) await Data.ensureEvidence();
    const charts = [];

    /* 1. AI share of US investment-grade issuance */
    const igSh = ser.us_ig_market && ser.us_ig_market.ai_share_of_ig_issuance_pct;
    if (igSh && igSh.points.length > 1) {
      charts.push(Rates.aiBarChart("AI's share of new US investment-grade bonds", igSh.points, "%", T["seg-tools"], "Of all new high-quality corporate bonds sold in the US each year, the share issued by AI-related borrowers. Doubled each year: 3.8% (2024) to ~24% (H1 2026). Sources: SIFMA, Bloomberg; the 2026 figure is the author's compilation."));
    }

    /* 2. Hyperscaler debt by company */
    const hd = ser.hyperscaler_debt || {};
    const debtNames = { alphabet_lt_debt_usd_bn: "Alphabet", amazon_lt_debt_usd_bn: "Amazon", microsoft_lt_debt_usd_bn: "Microsoft", meta_lt_debt_usd_bn: "Meta", oracle_lt_debt_usd_bn: "Oracle", coreweave_total_debt_usd_bn: "CoreWeave" };
    const debtBars = Object.entries(debtNames).map(([k, name]) => {
      const s = hd[k]; if (!s || !s.points.length) return null;
      const last = s.points[s.points.length - 1];
      return { name, v: last[1], date: last[0], grade: last[3] || "C", method: last[2], first: s.points[0] };
    }).filter(Boolean).sort((a, b) => b.v - a.v);
    if (debtBars.length) charts.push(Rates.debtBarChart("Long-term debt of the big AI builders", debtBars, T));

    const blocks = [];
    if (charts.length) blocks.push(`<div class="rates-ai-grid">${charts.join("")}</div>`);

    /* 3. CDS small multiples */
    const cdsSeries = ser.ai_cds || {};
    const cdsNames = { coreweave_cds_5y_bp: "CoreWeave", oracle_cds_5y_bp: "Oracle", nvidia_cds_5y_bp: "NVIDIA", alphabet_cds_5y_bp: "Alphabet", amazon_cds_5y_bp: "Amazon", meta_cds_5y_bp: "Meta" };
    const cdsData = Object.entries(cdsNames).map(([k, name]) => {
      const s = cdsSeries[k]; if (!s || !s.points.length) return null;
      return { name, pts: s.points, last: s.points[s.points.length - 1] };
    }).filter(Boolean);
    if (cdsData.length) blocks.push(Rates.cdsSmallMultiples("What it costs to insure against default", cdsData, T));

    /* 4. Remaining tiles from capital-layer segment nodes */
    const caps = (APP.idx.byLayer.capital || []).filter(n => n.type === "segment");
    const extraTiles = [];
    const stTile = (label, value, foot, tip, conf) => `<div class="tile rates-sig" title="${U.esc(tip)}"><div class="l">${label}</div><div class="v">${value}</div><div class="as">${foot}${conf ? " " + Rates._chip(conf) : ""}</div></div>`;
    for (const n of caps) {
      const s = ser[n.id] || {};
      const fin = n.fin || {}; const cap = n.cap || {};
      if (n.id === "ai_credit_tracker") {
        if (cap.backlog) extraTiles.push(stTile("Data-centre leases signed but not yet started", U.fmtStat(cap.backlog, "USD_bn"), `${U.asOf(cap.backlog[1])} · Moody's`, "Future rent that tenants have committed to on data centres still being built.", cap.backlog[2]));
        if (cap.util) extraTiles.push(stTile("Share of hyperscaler capex paid with debt", U.fmtStat(cap.util, "ratio"), `${U.asOf(cap.util[1])} · from 9% in FY2024`, "How much of the big cloud companies' spending on data centres and chips is funded by borrowing rather than cash flow.", cap.util[2]));
        if (fin.capex) extraTiles.push(stTile("Data-centre bonds and loans, 2026 so far", U.fmtStat(fin.capex, "USD_bn"), `${U.asOf(fin.capex[1])}`, "New bond and loan issuance tied to data centres this year.", fin.capex[2]));
      }
      if (n.id === "dc_abs_market") {
        const absSer = s.dc_securitisation_ytd_usd_bn;
        if (absSer && absSer.points.length) {
          const last = absSer.points[absSer.points.length - 1];
          extraTiles.push(stTile("Data-centre securitisation, year to date", `$${U.num(last[1], 0)}bn`, `${last[0]} · vs $4bn in 2020`, "Bonds backed by data-centre rents, sold to investors. A sign of how deep the funding market has become.", last[3]));
        }
      }
    }
    if (extraTiles.length) blocks.push(`<div class="tiles rates-sig-tiles">${extraTiles.join("")}</div>`);

    /* Evidence claims, folded away */
    const claimBlocks = []; let nClaims = 0;
    for (const n of caps) {
      const ev = APP.evidence && APP.evidence[n.id];
      const claims = ev && ev.claims;
      if (claims && claims.length) {
        nClaims += claims.length;
        claimBlocks.push(`<div class="rates-claims-block"><div class="rates-claims-title">${U.esc(n.name)}</div><ul class="ev claims">${claims.map(c => `<li>${U.esc(c.text)} ${Rates._chip(c.conf)}</li>`).join("")}</ul></div>`);
      }
    }
    if (claimBlocks.length) blocks.push(`<details class="rates-claims"><summary>The evidence behind these signals <span class="sum-sub">${nClaims} sourced notes, each graded: ${["A", "B", "C", "D"].map(g => `${Rates._chip(g)} ${Rates.GRADE[g]}`).join(", ")}</span></summary>${claimBlocks.join("")}</details>`);

    wrap.innerHTML = blocks.join("") || `<p class="note">No AI credit series yet.</p>`;
    /* tooltips on the static bar charts */
    U.$$("[data-tip]", wrap).forEach(n => {
      U.on(n, "mousemove", ev => Rates._showTip(ev, n.getAttribute("data-tip")));
      U.on(n, "mouseleave", Rates._hideTip);
    });
  },

  /* AI share bar chart (static svg, returned as html) */
  aiBarChart(title, points, unitLabel, colour, note) {
    if (!window.d3) return `<p class="note">${U.esc(title)}: chart library not loaded.</p>`;
    const W = 440, H = 220, m = { t: 22, r: 10, b: 26, l: 10 };
    const x = d3.scaleBand().domain(points.map(p => String(p[0]))).range([m.l, W - m.r]).padding(0.38);
    const maxV = d3.max(points, p => p[1]) * 1.15;
    const y = d3.scaleLinear().domain([0, maxV]).range([H - m.b, m.t]);
    const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", points.map(p => `${p[0]}: ${p[1]}%`).join(", "));
    svg.append("line").attr("class", "rates-base").attr("x1", m.l).attr("x2", W - m.r).attr("y1", H - m.b).attr("y2", H - m.b);
    svg.selectAll(".b").data(points).join("rect").attr("class", "rates-bar")
      .attr("data-tip", p => U.esc(`<b>${p[0]}${p[0] === "2026" ? " (first half)" : ""}</b><span class="t-row"><span>AI share of issuance</span><span class="t-num">${U.num(p[1], 1)}%</span></span><span class="t-note">${p[2] === "derived" ? "Derived from issuance totals" : U.esc(p[2] || "")}. Grade ${p[3] || "D"}: ${Rates.GRADE[p[3] || "D"]}.</span>`))
      .attr("x", p => x(String(p[0]))).attr("width", x.bandwidth()).attr("y", p => y(p[1])).attr("height", p => H - m.b - y(p[1])).attr("fill", colour).attr("rx", 3);
    svg.selectAll(".v").data(points).join("text").attr("class", "rates-bar-v").attr("x", p => x(String(p[0])) + x.bandwidth() / 2).attr("y", p => y(p[1]) - 7).attr("text-anchor", "middle").text(p => `${U.num(p[1], 1)}${unitLabel}`);
    svg.selectAll(".x").data(points).join("text").attr("class", "rates-bar-x").attr("x", p => x(String(p[0])) + x.bandwidth() / 2).attr("y", H - 8).attr("text-anchor", "middle").text(p => p[0] === "2026" ? "H1 2026" : p[0]);
    const grades = [...new Set(points.map(p => p[3] || "D"))];
    return `<div class="chart rates-ai-chart"><h3>${U.esc(title)}</h3>${note ? `<p>${U.esc(note)}</p>` : ""}${svg.node().outerHTML}<p class="rates-src">Grades: ${grades.map(g => Rates._chip(g)).join(" ")} ${grades.map(g => Rates.GRADE[g]).join("; ")}.</p></div>`;
  },

  /* Hyperscaler debt, horizontal bars (static svg, returned as html) */
  debtBarChart(title, bars, T) {
    if (!window.d3) return "";
    const W = 440, rowH = 34, m = { t: 4, r: 64, b: 6, l: 86 };
    const H = m.t + m.b + rowH * bars.length;
    const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", bars.map(d => `${d.name} $${U.num(d.v, 0)}bn`).join(", "));
    const x = d3.scaleLinear().domain([0, d3.max(bars, d => d.v) * 1.02]).range([m.l, W - m.r]);
    const y = d3.scaleBand().domain(bars.map(d => d.name)).range([m.t, H - m.b]).padding(0.3);
    const colour = T["seg-operators"];
    svg.selectAll(".b").data(bars).join("rect").attr("class", "rates-bar")
      .attr("data-tip", d => U.esc(`<b>${d.name}</b><span class="t-row"><span>${d.name === "CoreWeave" ? "Total debt" : "Long-term debt"}</span><span class="t-num">$${U.num(d.v, 1)}bn</span></span><span class="t-note">As of ${d.date}${d.first && d.first[0] !== d.date ? `, up from $${U.num(d.first[1], 1)}bn in ${d.first[0]}` : ""}. ${d.method === "estimated" ? "Estimate. " : ""}Grade ${d.grade}: ${Rates.GRADE[d.grade] || ""}.</span>`))
      .attr("x", m.l).attr("width", d => Math.max(2, x(d.v) - m.l)).attr("y", d => y(d.name)).attr("height", y.bandwidth())
      .attr("fill", colour).attr("opacity", d => d.name === "CoreWeave" ? 0.6 : 0.85).attr("rx", 3);
    svg.selectAll(".v").data(bars).join("text").attr("class", "rates-bar-v").attr("x", d => x(d.v) + 6).attr("y", d => y(d.name) + y.bandwidth() / 2).attr("dy", "0.35em").text(d => `$${U.num(d.v, 0)}bn`);
    svg.selectAll(".n").data(bars).join("text").attr("class", "rates-bar-l").attr("x", m.l - 8).attr("y", d => y(d.name) + y.bandwidth() / 2).attr("dy", "0.35em").attr("text-anchor", "end").text(d => d.name);
    const totalDebt = bars.reduce((s, d) => s + d.v, 0);
    const gs = [...new Set(bars.map(b => b.grade))].sort();
    return `<div class="chart rates-ai-chart"><h3>${U.esc(title)}</h3><p>Total ~$${U.num(totalDebt, 0)}bn, up from ~$270bn at the end of 2024. Mostly as of mid-2026 (2026Q2); CoreWeave is total debt. Hover a bar for the date and earlier figure.</p>${svg.node().outerHTML}<p class="rates-src">Sources: company filings and Bloomberg. Grades: ${gs.map(g => `${Rates._chip(g)} ${Rates.GRADE[g]}`).join("; ")}.</p></div>`;
  },

  /* CDS small multiples */
  cdsSmallMultiples(title, cdsData, T) {
    const W = 140, H = 64, pad = 4;
    const cards = cdsData.map(cd => {
      const last = cd.last;
      const maxV = Math.max(...cd.pts.map(p => p[1])); const minV = Math.min(...cd.pts.map(p => p[1]));
      const n = cd.pts.length;
      const sx = (i) => pad + (n > 1 ? i / (n - 1) : 0.5) * (W - 2 * pad);
      const sy = (v) => maxV === minV ? H / 2 : H - pad - ((v - minV) / (maxV - minV)) * (H - 2 * pad - 14);
      const d = cd.pts.map((p, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(" ");
      const colour = last[1] > 500 ? T.warn : last[1] > 100 ? T["seg-tools"] : T["seg-silicon"];
      const tip = `<b>${U.esc(cd.name)}: 5-year CDS</b>${cd.pts.map(p => `<span class="t-row"><span>${U.esc(p[0])}</span><span class="t-num">${U.num(p[1], 0)} bp</span></span>`).join("")}<span class="t-note">${U.num(last[1], 0)} bp = ${U.num(last[1] / 100, 2)}% of the insured amount per year. Grade ${U.esc(last[3] || "C")}: ${Rates.GRADE[last[3] || "C"]}.</span>`;
      return `<div class="rates-cds-card" data-tip="${U.esc(tip)}" tabindex="0"><div class="rates-cds-name">${U.esc(cd.name)}</div><div class="rates-cds-value" style="color:${colour}">${U.num(last[1], 0)} bp</div><svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="${colour}" stroke-width="2"/><circle cx="${sx(n - 1).toFixed(1)}" cy="${sy(last[1]).toFixed(1)}" r="3" fill="${colour}"/></svg><div class="rates-cds-date">${U.esc(cd.pts[0][0])} to ${U.esc(last[0])} ${Rates._chip(last[3] || "C")}</div></div>`;
    });
    return `<div class="chart rates-ai-chart rates-cds"><h3>${U.esc(title)}</h3><p>A credit default swap (CDS) is insurance on a company's debt. Its price, in basis points a year, is the market's read of default risk: 100 bp means paying 1% of the amount insured each year. Below 100 bp is very safe; several hundred signals real stress. Monthly snapshots from Bloomberg and the press, not live prices.</p><div class="rates-cds-grid">${cards.join("")}</div></div>`;
  },

  triggers(wrap, cur) {
    const ser = APP.series || {}; const S = (Rates.data && Rates.data.series) || {};
    const when = id => S[id] && S[id].latest ? S[id].latest[0] : "";
    const cw = ser.ai_credit_tracker && ser.ai_credit_tracker.coreweave_cds_bp ? ser.ai_credit_tracker.coreweave_cds_bp.points.slice(-1)[0] : null;
    const tp = Rates.data && Rates.data.series && Rates.data.series.THREEFYTP10 ? Rates.data.series.THREEFYTP10.latest : null;
    const igShare = ser.us_ig_market && ser.us_ig_market.ai_share_of_ig_issuance_pct ? ser.us_ig_market.ai_share_of_ig_issuance_pct.points.slice(-1)[0] : null;
    const debtTotal = ser.hyperscaler_debt && ser.hyperscaler_debt.total_hyperscaler_debt_usd_bn ? ser.hyperscaler_debt.total_hyperscaler_debt_usd_bn.points.slice(-1)[0] : null;
    const dkVar = ser.dk_mortgage_rates && ser.dk_mortgage_rates.variable_rate_share_new_loans_pct ? ser.dk_mortgage_rates.variable_rate_share_new_loans_pct.points.slice(-1)[0] : null;
    const rows = [
      { trigger: "US 10-year above 5.25% and CoreWeave CDS above 1,000 bp", why: "Rates and AI credit under stress at the same time", reading: cur.ten != null ? `${U.num(cur.ten, 2)}% · CDS ${cw ? cw[1] + " bp" : "no data"}` : "no data", status: cur.ten != null && cw ? (cur.ten > 5.25 && cw[1] > 1000 ? "armed" : "clear") : "na", src: "FRED, Bloomberg", date: cw ? cw[0] : "" },
      { trigger: "US 10-year inside the 5.1 to 5.4% fair-value range", why: "Confirms the author's view that AI spending lifts long-term rates", reading: cur.ten != null ? `${U.num(cur.ten, 2)}%` : "no data", status: cur.ten != null ? (cur.ten >= 5.1 ? "armed" : "clear") : "na", src: "FRED DGS10", date: when("DGS10") },
      { trigger: "Term premium above 80 bp", why: "Investors demand extra pay to lend for ten years", reading: tp ? `${Math.round(tp[1] * 100)} bp` : "no data", status: tp ? (tp[1] >= 0.80 ? "armed" : "clear") : "na", src: "FRED THREEFYTP10", date: tp ? tp[0] : "" },
      { trigger: "AI share of US investment-grade bond sales above 15%", why: "AI borrowing dominates the corporate bond market", reading: igShare ? `~${U.num(igShare[1], 0)}%` : "no data", status: igShare ? (igShare[1] >= 15 ? "armed" : "clear") : "na", src: "SIFMA, Bloomberg", date: igShare ? igShare[0] : "" },
      { trigger: "Hyperscaler debt above $400bn", why: "Debt large enough to matter for the whole credit market", reading: debtTotal ? `$${U.num(debtTotal[1], 0)}bn` : "no data", status: debtTotal ? (debtTotal[1] >= 400 ? "armed" : "clear") : "na", src: "Company filings, Bloomberg", date: debtTotal ? debtTotal[0] : "" },
      { trigger: "Danish 10-year at or above 3.75% (before end-2027)", why: "One of the author's published predictions", reading: cur.dk != null ? `${U.num(cur.dk, 2)}% (monthly)` : "no data", status: cur.dk != null ? (cur.dk >= 3.75 ? "armed" : "clear") : "na", src: "FRED IRLTLT01DKM156N", date: when("IRLTLT01DKM156N") },
      { trigger: "ECB deposit rate at or above 3.0% by mid-2027", why: "One of the author's published predictions", reading: cur.ecb != null ? `${U.num(cur.ecb, 2)}%` : "no data", status: cur.ecb != null ? (cur.ecb >= 3.0 ? "armed" : "clear") : "na", src: "FRED ECBDFR", date: when("ECBDFR") },
      { trigger: "Danish variable-rate mortgage share above 70%", why: "More households feel rate rises straight away", reading: dkVar ? `${U.num(dkVar[1], 0)}%` : "no data", status: dkVar ? (dkVar[1] >= 70 ? "armed" : "clear") : "na", src: "Nationalbanken", date: dkVar ? dkVar[0] : "" },
      { trigger: "Hyperscaler capex paid with debt above 45%", why: "The buildout relies on borrowing rather than profits", reading: "32% (LTM mid-2026)", status: "clear", src: "Author's compilation", date: "2026" },
      { trigger: "Oracle 5-year CDS above 300 bp", why: "A large AI builder's financing comes under strain", reading: "215 bp (Jul 2026)", status: "clear", src: "Bloomberg", date: "2026-07" },
    ];
    const armed = rows.filter(r => r.status === "armed").length;
    const total = rows.filter(r => r.status !== "na").length;
    rows.sort((a, b) => (a.status === "armed" ? 0 : a.status === "clear" ? 1 : 2) - (b.status === "armed" ? 0 : b.status === "clear" ? 1 : 2));
    const word = { armed: "crossed", clear: "not yet", na: "no data" };
    wrap.innerHTML = `<p class="rates-trigger-note"><b class="rates-trigger-summary">${armed} of ${total} levels crossed.</b> Each row is a level the author set in advance as a sign that the buildout is straining the cost of money. <b>Crossed</b> means the latest reading is past it; <b>not yet</b> means it is not. Readings come straight from the series named, so the table moves when the data does.</p>
      <div class="rates-trigger-table"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Status</th><th>Level watched</th><th>Why it matters</th><th class="num">Latest</th><th>Source</th></tr></thead><tbody>${rows.map(r => `<tr class="rt-${r.status}"><td><span class="st ${r.status}">${word[r.status]}</span></td><td class="rates-trig-what">${U.esc(r.trigger)}</td><td class="rates-trig-why">${U.esc(r.why)}</td><td class="num">${U.esc(r.reading)}</td><td class="rates-trig-src">${U.esc(r.src)}<span>${U.esc(r.date)}</span></td></tr>`).join("")}</tbody></table></div></div>`;
  },
};

/* re-draw the live strip on every live update, only while this view is open */
if (typeof Live !== "undefined") Live.on(() => { if (APP.state && APP.state.view === "rates" && U.$("#rates-live")) { Rates.renderLive(); Live.flash(U.$("#rates-live")); } });
/* Bottlenecks view (#v=bottlenecks): where the AI buildout is constrained.
   A ranked list of layers (a grid on desktop, cards on a phone), the scoring
   method in plain words, a score-against-valuation chart and one card per layer.
   Every figure comes straight from graph.json; the only derived display values
   are the score band words, the growth gap (capacity minus demand) and the
   data-coverage share, each labelled where it appears. */
const Dashboard = {
  sortKey: "score",
  sortDir: "desc",
  scatterMode: "layer",
  open: {},                /* layer id -> risk list expanded */
  MIN_CONF: 0.35,          /* config/bottleneck.yaml: min_confidence */
  SEV: { high: 0, med: 1, low: 2 },
  SEV_WORD: { high: "high", med: "medium", low: "low" },
  X_MID: 3,                /* the "firm" threshold, also the divider on the chart */

  /* weights from config/bottleneck.yaml; scoring rules from pipeline/derive.py
     (utilization buckets 95/85/75%, lead time 12 to 104 weeks, backlog capped
     at 3 years, relief horizon 4 years) */
  INPUT_META: {
    U: { name: "Utilisation", w: 0.22, what: "How close to full the capacity runs.", how: "Running at 95% or more scores 1.0; 85% scores 0.7; 75% scores 0.4; anything lower 0.1. Uses the company's own figure, else the layer's." },
    C: { name: "Concentration", w: 0.18, what: "How few suppliers make it.", how: "Half the market's HHI concentration index (out of 10,000) plus half the company's own market share." },
    A: { name: "Substitutability", w: 0.15, what: "Whether buyers could switch to an alternative.", how: "1 minus the maturity of the best alternative: none 0, lab 0.2, pilot 0.4, ramping 0.7, mature 1." },
    L: { name: "Lead time", w: 0.13, what: "How long a new order waits.", how: "Weeks beyond a 12-week baseline, reaching the full 1.0 at 104 weeks (two years)." },
    S: { name: "Upstream rationing", w: 0.12, what: "How full its own suppliers are.", how: "The utilisation of the tightest supplier feeding it, on the same scale as utilisation; falls back to the layer below." },
    B: { name: "Backlog", w: 0.10, what: "Orders waiting, relative to a year of revenue.", how: "Backlog divided by annual revenue, capped at three years; or book-to-bill minus 1." },
    R: { name: "Relief year", w: 0.10, what: "How many years until new capacity catches up.", how: "Years from now to the relief year, divided by 4, capped at 1." },
  },

  /* ---- plain-language helpers ---- */
  band(s) {
    if (s == null) return { word: "Not scored", cls: "none" };
    if (s >= 4) return { word: "Tight", cls: "tight" };
    if (s >= Dashboard.X_MID) return { word: "Firm", cls: "firm" };
    return { word: "Loose", cls: "loose" };
  },
  evidence(c) {
    if (c == null) return "";
    if (c >= 0.6) return "Good data";
    if (c >= 0.45) return "Partial data";
    return "Thin data";
  },
  gradeWord(g) { return { A: "official filing or dataset", B: "company statement or reputable dataset", C: "trade press or analyst", D: "our estimate" }[g] || ""; },
  fmtScore(s) { return s == null ? "" : Number(s).toFixed(1); },
  signed(v) { return (v >= 0 ? "+" : "−") + U.num(Math.abs(v), 0); },
  tipAttr(t) { return t ? ` data-tip="${U.esc(t)}" tabindex="0"` : ""; },

  stamp(lay, key) {
    const t = (lay.stats || {})[key]; const s = t ? U.stat(t) : null;
    if (!s) return "";
    const what = { fill_pct: "Capacity-in-use figure", capacity_growth_pct_yr: "capacity growth", demand_growth_pct_yr: "demand growth", supply_gap_pct: "supply gap" }[key] || key.replace(/_/g, " ");
    return `${what}: ${U.asOf(s.as_of)}, grade ${s.conf} (${Dashboard.gradeWord(s.conf)})${s.method === "estimated" ? ", estimated" : s.method && s.method !== "measured" ? `, ${s.method}` : ""}`;
  },

  /* ---- capacity in use: guard against utilization stored as a percent upstream ---- */
  fillOf(lay) {
    const t = lay.totals || {};
    let pct = t.fill_pct, note = "", suspect = false;
    if (pct == null) return { pct: null, text: "–", note: "Capacity in use is not quantified for this layer.", suspect: false };
    if (pct > 150 && t.utilization_mean != null && t.utilization_mean > 1.5 && t.utilization_mean <= 100) {
      pct = t.utilization_mean; suspect = true;
      note = `Shown as ${U.num(t.utilization_mean, 0)}% from the mean of company utilisation; the build reports ${U.num(t.fill_pct, 0)}% because some entries store utilisation as a percent and others as a ratio.`;
    }
    const text = pct > 120 ? ">100%" : U.num(Math.min(pct, 100), 0) + "%";
    if (!note) note = t.fill_source === "curated" ? "A layer-wide figure with its own source." : t.fill_source === "nodes" ? "The average utilisation its companies report." : "";
    if (pct > 100 && !suspect) note = `Reported at ${U.num(pct, 0)}%: running above nameplate capacity.` + (note ? ` ${note}` : "");
    return { pct, text, note, suspect };
  },

  /* ---- confidence of the layer score: the nodes that set it ---- */
  layerConf(layId) {
    const all = APP.idx.byLayer[layId] || [];
    const scored = all.filter(n => n.bn && n.bn.effective != null && n.bn.confidence != null);
    if (!scored.length) return null;
    const mean = scored.reduce((s, n) => s + n.bn.confidence, 0) / scored.length;
    return { mean, n: scored.length, of: all.length };
  },

  bestConf(layId) {
    const all = (APP.idx.byLayer[layId] || []).filter(n => n.bn && n.bn.confidence != null);
    if (!all.length) return null;
    return all.reduce((b, n) => (n.bn.confidence > b.bn.confidence ? n : b), all[0]);
  },

  layerMissing(layId, scoredOnly) {
    const nodes = (APP.idx.byLayer[layId] || []).filter(n => n.bn && (scoredOnly === false || n.bn.effective != null));
    if (!nodes.length) return [];
    return Object.keys(Dashboard.INPUT_META)
      .map(k => ({ k, miss: nodes.filter(n => !(k in (n.bn.inputs || {}))).length, n: nodes.length, w: Dashboard.INPUT_META[k].w }))
      .filter(r => r.miss > r.n * 0.3)
      .sort((a, b) => b.w - a.w);
  },

  whyNoScore(lay) {
    const IM = Dashboard.INPUT_META;
    const all = APP.idx.byLayer[lay.id] || [];
    const withBn = all.filter(n => n.bn && n.bn.confidence != null);
    if (!all.length) return "This layer has no entries in the graph.";
    const best = Dashboard.bestConf(lay.id);
    const have = new Set();
    withBn.forEach(n => Object.keys(n.bn.inputs || {}).forEach(k => have.add(k)));
    const haveTxt = have.size
      ? `Only ${[...have].sort((a, b) => IM[b].w - IM[a].w).map(k => `<b>${IM[k].name.toLowerCase()}</b>`).join(", ")} ${have.size === 1 ? "is" : "are"} recorded anywhere in the layer.`
      : "None of the seven inputs is recorded for any entry here.";
    const bestTxt = best && best.bn.confidence > 0
      ? `The best-covered entry, ${U.esc(best.name)}, has inputs worth ${Math.round(best.bn.confidence * 100)}% of the weight; a score needs ${Math.round(Dashboard.MIN_CONF * 100)}%.`
      : `No entry carries any of the seven inputs, so there is nothing to weigh.`;
    const need = Object.keys(IM).filter(k => !have.has(k)).sort((a, b) => IM[b].w - IM[a].w).slice(0, 3);
    return `<b>Not scored: too little data.</b> ${bestTxt} ${haveTxt}${need.length ? ` Adding ${need.map(k => `<b>${IM[k].name.toLowerCase()}</b> (${Math.round(IM[k].w * 100)}% of the weight)`).join(", ")} for these ${all.length} entries would score it.` : ""}`;
  },

  whatWouldChange(lay) {
    const IM = Dashboard.INPUT_META;
    const conf = Dashboard.layerConf(lay.id);
    const missing = Dashboard.layerMissing(lay.id);
    if (!conf || !missing.length) return "";
    const top = missing.slice(0, 3);
    const gain = top.reduce((s, r) => s + r.w, 0);
    const to = Math.min(1, conf.mean + gain);
    const rest = missing.length - top.length;
    return `<b>What would firm up this score:</b> ${top.map(r => `<b>${IM[r.k].name.toLowerCase()}</b> (${Math.round(r.w * 100)}% of the weight, missing for ${r.miss} of ${r.n} scored entries)`).join(", ")}${rest ? `, and ${rest} lighter input${rest === 1 ? "" : "s"}` : ""}. With those, the data behind it would rise from ${Math.round(conf.mean * 100)}% toward ${Math.round(to * 100)}% of the weight.`;
  },

  riskSummary(lay) {
    const rs = lay.risks || [];
    const counts = { high: 0, med: 0, low: 0 };
    rs.forEach(r => { if (counts[r.severity] != null) counts[r.severity]++; });
    /* numeric rank, never `||`: high === 0 is falsy */
    const sorted = [...rs].sort((a, b) => (Dashboard.SEV[a.severity] ?? 3) - (Dashboard.SEV[b.severity] ?? 3));
    return { top: sorted[0] || null, sorted, counts, n: rs.length, weight: counts.high * 100 + counts.med * 10 + counts.low };
  },
  riskCountText(c) { return ["high", "med", "low"].filter(s => c[s]).map(s => `${c[s]} ${Dashboard.SEV_WORD[s]}`).join(", "); },
  /* cut at a word boundary, never mid-word */
  shorten(s, max) {
    if (s.length <= max) return { text: s, cut: false };
    const i = s.lastIndexOf(" ", max);
    return { text: s.slice(0, i > max * 0.6 ? i : max).replace(/[,;:.\s]+$/, "") + "…", cut: true };
  },
  srcLink(r) {
    const s = APP.data.sources[r.src];
    const url = s && s.url && s.url.startsWith("http") ? s.url : null;
    const label = s ? (s.publisher || s.title) : r.src;
    return `<span class="bn-src">${U.gradeChip(r.conf)} ${url ? `<a href="${U.esc(url)}" target="_blank" rel="noopener">${U.esc(label)}</a>` : U.esc(label || "")}</span>`;
  },

  /* ---- sorting ---- */
  gapOf(t) { const c = t.capacity_growth_pct_yr, d = t.demand_growth_pct_yr; return c != null && d != null ? c - d : null; },
  sortVal(lay, key) {
    const t = lay.totals || {};
    switch (key) {
      case "score": return lay.score;
      case "name": return lay.name.toLowerCase();
      case "order": return lay.order;
      case "fill": { const f = Dashboard.fillOf(lay); return f.pct == null ? null : Math.min(f.pct, 200); }
      case "gap": return Dashboard.gapOf(t);
      case "pe": return t.fin ? t.fin.pe_fwd_median : null;
      case "est": return t.n_nodes ? (t.n_nodes - (t.n_est_only || 0)) / t.n_nodes : null;
      case "risk": { const r = Dashboard.riskSummary(lay); return r.n ? r.weight : null; }
      case "mcap": { const lv = Dashboard.live(lay); return lv ? lv.m : (t.fin && t.fin.mcap_sum_usd_bn) || null; }
      case "today": { const lv = Dashboard.live(lay); return lv ? lv.c : null; }
      default: return null;
    }
  },
  doSort(layers) {
    const dir = Dashboard.sortDir === "desc" ? 1 : -1;
    return layers.sort((a, b) => {
      const va = Dashboard.sortVal(a, Dashboard.sortKey), vb = Dashboard.sortVal(b, Dashboard.sortKey);
      if (va == null && vb == null) return a.order - b.order;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string") return vb.localeCompare(va) * dir;
      return (vb - va) * dir;
    });
  },

  /* ---- live market data (35_live.js); null until live.json has loaded ---- */
  live(lay) {
    if (typeof Live === "undefined" || !Live.ready) return null;
    return Live.layerToday(lay.id);
  },
  liveTip(lv) {
    return `Combined market cap of the ${lv.n} listed compan${lv.n === 1 ? "y" : "ies"} in this layer at the latest quote, and their move since the previous close, weighted by market cap. Yahoo Finance quotes (grade C, some delayed 15 to 20 minutes), updated ${Live.ago()}.`;
  },

  /* ---- headline ---- */
  headline(layers) {
    const scored = layers.filter(l => l.score != null).sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 3);
    const nTight = scored.filter(l => l.score >= 4).length;
    const liveOn = typeof Live !== "undefined" && Live.ready;
    return `<header class="bn-head">
      <div class="bn-kicker">Bottlenecks${liveOn ? ` <span class="bn-livetag">${Live.dot()} Live market data, updated <span class="live-ago">${Live.ago()}</span></span>` : ""}</div>
      <h2>Where the AI buildout is constrained</h2>
      <p class="bn-lede">Each layer of the chain gets a <b>constraint score from 0 to 5</b>. A high score means more supply is hard to get: capacity is nearly full, few firms make it, there is no ready substitute and new capacity is years away. ${scored.length} of ${layers.length} layers have enough data to be scored, and ${nTight} are tight.</p>
      <div class="bn-top" aria-label="Tightest layers">
        ${top.map(l => { const b = Dashboard.band(l.score); const lv = Dashboard.live(l); return `<button class="bn-top-i" data-scroll="${l.id}"><span class="bn-top-s band-${b.cls}">${Dashboard.fmtScore(l.score)}</span><span class="bn-top-name"><i class="dot" style="background:var(--seg-${U.segment(l.kind)})"></i>${U.esc(l.name)}</span>${lv ? `<span class="bn-top-live">${Live.chg(lv.c)}</span>` : ""}</button>`; }).join("")}
      </div>
    </header>`;
  },

  /* ---- how the score works ---- */
  explainer() {
    const IM = Dashboard.INPUT_META;
    const keys = Object.keys(IM);
    const max = Math.max(...keys.map(k => IM[k].w));
    const rows = keys.map(k => `<div class="bn-w"${Dashboard.tipAttr(`${IM[k].what} ${IM[k].how}`)}><span class="bn-w-n">${U.esc(IM[k].name)}</span><span class="bn-w-t"><i style="width:${IM[k].w / max * 100}%"></i></span><span class="bn-w-p">${Math.round(IM[k].w * 100)}%</span></div>`).join("");
    const items = keys.map(k => `<div class="bn-in"><div class="bn-in-h"><b>${U.esc(IM[k].name)}</b><em>${Math.round(IM[k].w * 100)}%</em></div><p>${U.esc(IM[k].what)}</p><p class="bn-in-how">${U.esc(IM[k].how)}</p></div>`).join("");
    return `<section class="bn-how" aria-labelledby="bn-how-h">
      <div class="bn-how-l">
        <h3 id="bn-how-h">How the score works</h3>
        <p>Seven signals, each scored 0 to 1 for every company or product, weighted as shown and multiplied by five. Unknown signals are skipped, not counted as zero.</p>
        <div class="bn-bands"><span><b class="band-tight">Tight</b> 4 to 5</span><span><b class="band-firm">Firm</b> 3 to 3.9</span><span><b class="band-loose">Loose</b> below 3</span></div>
      </div>
      <div class="bn-how-r" role="img" aria-label="Score weights: ${keys.map(k => `${IM[k].name} ${Math.round(IM[k].w * 100)}%`).join(", ")}">${rows}</div>
      <details class="bn-rules"><summary>Scoring rules in full</summary>
        <div class="bn-in-grid">${items}</div>
        <div class="bn-rules-note"><p>The <b>data</b> label beside each score is the share of the total weight carried by signals we actually know: a score built on utilisation and concentration alone rests on 40%. Good data means 60% or more, partial 45% to 59%, thin below 45%. Nothing is scored below ${Math.round(Dashboard.MIN_CONF * 100)}%.</p>
        <p>A layer's score is the average of its companies' scores, weighted by market share, so a high score on thin data describes the few companies that disclose numbers. The score ranks layers; it is not a probability. The bands are a reading aid for this page. Weights are set in <code>config/bottleneck.yaml</code>; the full method is under Findings, "How the ranking works".</p></div>
      </details>
    </section>`;
  },

  /* ---- ranked list (rows on desktop, cards on a phone) ---- */
  COLS: [
    { key: "name", label: "Layer", tip: "Click a name to jump to its card. Click a heading to sort." },
    { key: "score", label: "Constraint", tip: "Score 0 to 5: how hard it is to get more of this layer's output. Tight 4 to 5, firm 3 to 3.9, loose below 3. The data label says how much of the scoring weight rests on known figures." },
    { key: "fill", label: "Capacity in use", tip: "How much of the layer's production capacity is already used. 100% means sold out.", num: true },
    { key: "gap", label: "Demand vs capacity", tip: "Capacity growth minus demand growth, in percentage points a year. Negative means demand is growing faster than supply, so the squeeze is getting worse. Positive means capacity is catching up.", num: true },
    { key: "pe", label: "Valuation", tip: "Median forward price-to-earnings ratio of the listed companies, as of the build: share price over next year's expected earnings per share. Higher means investors pay more for each dollar of future profit.", num: true },
    { key: "mcap", label: "Market cap", tip: "Combined market cap of the listed companies in the layer, live where quotes are available, with today's move since the previous close.", num: true },
  ],

  rankList(layers) {
    const K = Dashboard.sortKey, D = Dashboard.sortDir;
    const head = Dashboard.COLS.map(c => `<div class="bn-th${c.num ? " num" : ""}${K === c.key ? " on" : ""}" role="columnheader" aria-sort="${K === c.key ? (D === "desc" ? "descending" : "ascending") : "none"}"><button data-sort="${c.key}" data-tip="${U.esc(c.tip)}">${U.esc(c.label)}<span class="bn-arr">${K === c.key ? (D === "desc" ? "↓" : "↑") : ""}</span></button></div>`).join("") + `<div class="bn-th" role="columnheader"><span class="sr">Detail</span></div>`;
    const lab = c => { const col = Dashboard.COLS.find(x => x.key === c); return `<span class="bn-ml"${Dashboard.tipAttr(col.tip)}>${col.label}</span>`; };

    const rows = layers.map(lay => {
      const t = lay.totals || {};
      const seg = U.segment(lay.kind);
      const b = Dashboard.band(lay.score);
      const conf = Dashboard.layerConf(lay.id);
      const isOpen = !!Dashboard.open[lay.id];

      const scoreTip = lay.score != null
        ? `Score ${Dashboard.fmtScore(lay.score)} of 5 (${b.word.toLowerCase()}). ${conf ? `Built from ${conf.n} of ${conf.of} entries; on average their known signals carry ${Math.round(conf.mean * 100)}% of the scoring weight.` : ""}`
        : Dashboard.whyNoScore(lay).replace(/<[^>]+>/g, "");
      const scoreHtml = lay.score != null
        ? `<div class="bn-score band-${b.cls}"${Dashboard.tipAttr(scoreTip)}>
             <b class="bn-snum">${Dashboard.fmtScore(lay.score)}</b>
             <div class="bn-sbody"><div class="bn-strack"><i style="width:${lay.score / 5 * 100}%"></i></div>
             <div class="bn-conf"><span class="bn-sword">${b.word}</span>${conf ? ` · ${Dashboard.evidence(conf.mean).toLowerCase()} (${Math.round(conf.mean * 100)}%)` : ""}</div></div>
           </div>`
        : `<div class="bn-score band-none"${Dashboard.tipAttr(scoreTip)}><span class="bn-snum">–</span><div class="bn-sbody"><div class="bn-conf">Not scored, too little data</div></div></div>`;

      const fill = Dashboard.fillOf(lay);
      const fillHtml = fill.pct == null
        ? `<span class="na"${Dashboard.tipAttr(fill.note)}>–</span>`
        : `<span class="bn-v"${Dashboard.tipAttr(`${fill.note} ${Dashboard.stamp(lay, "fill_pct")}`.trim())}>${fill.text}${fill.suspect ? `<span class="flag">!</span>` : ""}</span>`;

      const capG = t.capacity_growth_pct_yr, demG = t.demand_growth_pct_yr;
      const gap = Dashboard.gapOf(t);
      let gapHtml;
      if (gap == null) {
        const why = capG == null && demG == null ? "Neither growth rate is recorded." : capG == null ? `No capacity-growth figure (demand grows ${Dashboard.signed(demG)}% a year).` : `No demand-growth figure (capacity grows ${Dashboard.signed(capG)}% a year).`;
        gapHtml = `<span class="na"${Dashboard.tipAttr(why)}>–</span>`;
      } else {
        const tip = `Capacity ${Dashboard.signed(capG)}% a year against demand ${Dashboard.signed(demG)}% a year: ${gap < 0 ? `demand is outgrowing supply by ${U.num(-gap, 0)} percentage points a year` : `supply is outgrowing demand by ${U.num(gap, 0)} percentage points a year`}.`;
        gapHtml = `<span class="bn-gap ${gap < 0 ? "neg" : "pos"}"${Dashboard.tipAttr(tip)}><span class="bn-v">${Dashboard.signed(gap)} pts</span><span class="bn-gword">${gap < 0 ? "demand faster" : "capacity faster"}</span></span>`;
      }

      const pe = t.fin ? t.fin.pe_fwd_median : null, peN = t.fin ? t.fin.pe_fwd_n : 0;
      const peHtml = pe != null
        ? `<span class="bn-pe"${Dashboard.tipAttr(`Median forward P/E of ${peN} listed compan${peN === 1 ? "y" : "ies"}, as of the build${t.fin.pe_fwd_wavg != null ? `; weighted by market cap it is ${U.num(t.fin.pe_fwd_wavg, 1)}x` : ""}.${peN < 3 ? " Too few companies for the median to say much about the layer." : ""}`)}><span class="bn-v">${U.num(pe, 1)}x</span>${peN < 3 ? `<span class="bn-sub warn">${peN} compan${peN === 1 ? "y" : "ies"}</span>` : ""}</span>`
        : `<span class="na"${Dashboard.tipAttr("No listed company in this layer has a forward P/E.")}>–</span>`;

      const lv = Dashboard.live(lay);
      const mcapBuild = t.fin ? t.fin.mcap_sum_usd_bn : null;
      const mcapHtml = lv
        ? `<span class="bn-mc"${Dashboard.tipAttr(Dashboard.liveTip(lv))}><span class="bn-v live-num">${U.fmtVal(lv.m, "USD_bn")}</span>${Live.chg(lv.c)}</span>`
        : mcapBuild ? `<span class="bn-mc"${Dashboard.tipAttr("Combined market cap of the listed companies, as of the build (no live quote available).")}><span class="bn-v">${U.fmtVal(mcapBuild, "USD_bn")}</span><span class="bn-sub">at build</span></span>`
        : `<span class="na"${Dashboard.tipAttr("No listed companies in this layer.")}>–</span>`;

      const r = Dashboard.riskSummary(lay);
      const estN = t.n_est_only || 0, hard = t.n_nodes ? t.n_nodes - estN : null;
      const detail = isOpen ? `<div class="bn-detail" role="cell">
          <div class="bn-d-risks"><div class="bn-k">Risks${r.n ? ` · ${Dashboard.riskCountText(r.counts)}` : ""}</div>
            ${r.n ? `<ul class="bn-rall">${r.sorted.map(x => `<li><span class="sev sev-${x.severity}">${Dashboard.SEV_WORD[x.severity] || x.severity}</span><span>${U.esc(x.text)} ${Dashboard.srcLink(x)}</span></li>`).join("")}</ul>` : `<p class="na">No risks recorded.</p>`}</div>
          <div class="bn-d-side">
            ${t.n_nodes ? `<div><div class="bn-k">Data coverage</div><p>${hard} of ${t.n_nodes} entries carry a market cap or capacity figure; ${estN} are our estimates.</p></div>` : ""}
            ${Dashboard.signalsHtml(lay, true)}
            <button class="bn-linkbtn" data-scroll="${lay.id}">Go to the ${U.esc(lay.name)} card</button>
          </div>
        </div>` : "";
      const topRisk = r.top ? Dashboard.shorten(r.top.text, 120).text : "";

      return `<div class="bn-row${isOpen ? " open" : ""}" role="row" data-layer-row="${lay.id}">
        <div class="bn-td bn-name" role="cell"><i class="dot" style="background:var(--seg-${seg})"></i><button class="rank-link" data-scroll="${lay.id}">${U.esc(lay.name)}</button></div>
        <div class="bn-td bn-c-score" role="cell">${scoreHtml}</div>
        <div class="bn-td num" role="cell">${lab("fill")}${fillHtml}</div>
        <div class="bn-td num" role="cell">${lab("gap")}${gapHtml}</div>
        <div class="bn-td num" role="cell">${lab("pe")}${peHtml}</div>
        <div class="bn-td num" role="cell">${lab("mcap")}${mcapHtml}</div>
        <div class="bn-td bn-c-more" role="cell"><button class="bn-more-btn" data-risk="${lay.id}" aria-expanded="${isOpen}" title="${U.esc(r.top ? `Biggest risk: ${topRisk}` : "Show detail")}"><span class="bn-more-t">${isOpen ? "Close" : r.n ? `${r.n} risk${r.n === 1 ? "" : "s"}` : "Detail"}</span><span class="bn-chev" aria-hidden="true"></span></button></div>
        ${detail}
      </div>`;
    }).join("");

    const sortNames = { score: "constraint score", fill: "capacity in use", gap: "demand vs capacity", pe: "valuation", mcap: "market cap", today: "today's move", name: "layer name" };
    return `<section class="bn-rank-sec" aria-labelledby="bn-rank-h">
      <div class="bn-sec-h"><h3 id="bn-rank-h">All layers, ranked</h3>
        <label class="bn-sortsel">Sort by <select id="bn-sort">${Object.entries(sortNames).map(([k, v]) => `<option value="${k}"${k === K ? " selected" : ""}>${v}</option>`).join("")}</select></label>
        <p class="bn-sec-note">Hover a heading or a figure for what it means; a dash means not recorded yet. Open a row for its risks.</p></div>
      <div class="bn-rank" role="table" aria-label="Layers ranked by ${U.esc(sortNames[K] || K)}">
        <div class="bn-row bn-hrow" role="row">${head}</div>
        ${rows}
      </div>
    </section>`;
  },

  /* ---- live market signals for a layer (copper on minerals, gas on power, ...) ---- */
  signalsHtml(lay, compact) {
    if (typeof Live === "undefined" || !Live.ready) return "";
    const mks = Live.marketsFor(lay.id);
    if (!mks.length) return "";
    return `<div class="bn-sig${compact ? " compact" : ""}"><div class="bn-k">Market signals${compact ? "" : `, live`}</div>
      ${mks.map(mk => { const h = Live.history(mk.key); return `<div class="bn-sig-r" title="${U.esc(`${mk.label}: latest quote and change since the previous close${mk.kind === "yield" ? " in basis points" : ""}. Yahoo Finance (grade C), updated ${Live.ago(mk.ts)}.`)}"><span class="bn-sig-n">${U.esc(mk.label)}</span>${h.length > 1 ? Live.spark(h, 56, 16) : ""}<span class="bn-sig-v live-num">${Live.marketValue(mk)}</span>${Live.marketChg(mk)}</div>`; }).join("")}
    </div>`;
  },
  /* ---- scatter: score against valuation ---- */
  scatter(wrap, layers) {
    if (!window.d3) return;
    const T = APP.tokens;
    const mode = Dashboard.scatterMode;
    let pts, skipped = [], universe = 0;
    if (mode === "node") {
      universe = APP.data.nodes.length;
      pts = APP.data.nodes
        .filter(n => n.bn && n.bn.effective != null && n.fin && n.fin.pe_fwd)
        .map(n => {
          const lay = U.layerOf(n.layer);
          return { id: n.id, name: n.name, layerName: lay ? lay.name : "", x: n.bn.effective, y: n.fin.pe_fwd[0], mcap: n.fin.mcap ? n.fin.mcap[0] : 0.1, seg: U.segment(lay ? lay.kind : ""), inputs: n.bn.inputs || {}, confidence: n.bn.confidence, isNode: true };
        });
    } else {
      universe = layers.length;
      pts = layers
        .filter(l => l.score != null && l.totals && l.totals.fin && l.totals.fin.pe_fwd_median != null)
        .map(l => ({ id: l.id, name: l.name, x: l.score, y: l.totals.fin.pe_fwd_median, fwdN: l.totals.fin.pe_fwd_n, mcap: l.totals.fin.mcap_sum_usd_bn || 1, seg: U.segment(l.kind), fillPct: Dashboard.fillOf(l).pct, gap: Dashboard.gapOf(l.totals), avgConf: (Dashboard.layerConf(l.id) || {}).mean, isNode: false }));
      skipped = layers.filter(l => !(l.score != null && l.totals && l.totals.fin && l.totals.fin.pe_fwd_median != null))
        .map(l => `${l.name} (${l.score == null ? "not scored" : "no listed forward P/E"})`);
    }
    if (pts.length < 2) {
      wrap.insertAdjacentHTML("beforeend", `<div class="sk-state sk-state-sparse"><h3>Not enough to plot</h3><p>${pts.length} of ${universe} ${mode === "node" ? "companies" : "layers"} carry both a constraint score and a forward P/E.</p></div>`);
      return;
    }

    /* draw at the real width so text stays legible on a phone */
    const cw = Math.max(320, Math.min(1100, wrap.clientWidth - 24 || 960));
    const narrow = cw < 600;
    const W = cw, H = narrow ? 340 : 400, mg = { t: 30, r: narrow ? 14 : 26, b: 44, l: narrow ? 40 : 50 };
    const xMax = Math.max(5.2, d3.max(pts, d => d.x) + 0.3);
    const ysSorted = pts.map(d => d.y).sort((a, b) => a - b);
    const p90 = d3.quantile(ysSorted, 0.9) ?? ysSorted[ysSorted.length - 1];
    const rawMax = d3.max(pts, d => d.y);
    const yMax = Math.max(40, Math.min(rawMax * 1.15, p90 * 1.45));
    const clipped = pts.filter(d => d.y > yMax);
    const xMin = Math.max(0, Math.floor(d3.min(pts, d => d.x) - 0.5));
    const xS = d3.scaleLinear().domain([xMin, xMax]).range([mg.l, W - mg.r]);
    const yS = d3.scaleLinear().domain([0, yMax]).nice().range([H - mg.b, mg.t]);
    const rMax = narrow ? (mode === "node" ? 10 : 16) : (mode === "node" ? 15 : 26);
    const rS = d3.scaleSqrt().domain([0, d3.max(pts, d => d.mcap)]).range(mode === "node" ? [3, rMax] : [4, rMax]);

    const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("width", W).attr("height", H).style("max-width", "100%").style("height", "auto")
      .attr("role", "img").attr("aria-label", `Constraint score against forward P/E for ${pts.length} ${mode === "node" ? "companies" : "layers"}`);
    svg.append("g").attr("class", "grid").selectAll("line").data(yS.ticks(5)).join("line")
      .attr("x1", mg.l).attr("x2", W - mg.r).attr("y1", d => yS(d)).attr("y2", d => yS(d));

    const xMid = Dashboard.X_MID, yMid = d3.median(pts, d => d.y) || 20;
    svg.append("rect").attr("class", "quad-hot").attr("x", xS(xMid)).attr("y", yS(yMid)).attr("width", W - mg.r - xS(xMid)).attr("height", H - mg.b - yS(yMid));
    svg.append("line").attr("class", "quad-div").attr("x1", xS(xMid)).attr("x2", xS(xMid)).attr("y1", mg.t).attr("y2", H - mg.b);
    svg.append("line").attr("class", "quad-div").attr("x1", mg.l).attr("x2", W - mg.r).attr("y1", yS(yMid)).attr("y2", yS(yMid));
    const ql = (text, px, py, anchor, cls) => svg.append("text").attr("class", "quad-lbl" + (cls ? " " + cls : "")).attr("x", px).attr("y", py).attr("text-anchor", anchor).text(text);
    const pad = 8;
    ql("looser, pricier", mg.l + pad, mg.t + 10, "start");
    ql("tighter, pricier", W - mg.r - pad, mg.t + 10, "end");
    ql("looser, cheaper", mg.l + pad, H - mg.b - pad, "start");
    ql("tighter, cheaper", W - mg.r - pad, H - mg.b - pad, "end", "hot");
    const medTxt = `median ${U.num(yMid, 1)}x`;
    svg.append("text").attr("class", "quad-note").attr("x", mg.l + 4).attr("y", yS(yMid) - 4).text(medTxt);

    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - mg.b})`).call(d3.axisBottom(xS).ticks(narrow ? 4 : 6).tickSizeOuter(0));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${mg.l},0)`).call(d3.axisLeft(yS).ticks(5).tickFormat(d => d + "x").tickSizeOuter(0));
    svg.append("text").attr("class", "lbl").attr("x", W - mg.r).attr("y", H - 6).attr("text-anchor", "end").style("font-size", "11px").style("fill", T["ink-3"]).text("constraint score (0 to 5), tighter →");
    svg.append("text").attr("class", "lbl").attr("x", mg.l - (narrow ? 30 : 38)).attr("y", mg.t - 14).style("font-size", "11px").style("fill", T["ink-3"]).text("↑ valuation (forward P/E)");

    const gp = svg.append("g").selectAll("g").data(pts).join("g").style("cursor", "pointer")
      .attr("tabindex", -1)
      .on("click", (ev, d) => { if (d.isNode) State.set({ node: d.id, layer: null }); else State.set({ layer: d.id, node: null }); });
    const py = d => yS(Math.min(d.y, yMax));
    gp.attr("class", d => d.y > yMax ? "pt clipped" : "pt");
    gp.append("circle").attr("cx", d => xS(d.x)).attr("cy", d => py(d)).attr("r", d => rS(d.mcap))
      .attr("fill", d => T["seg-" + d.seg] || T["ink-3"]).attr("fill-opacity", 0.55)
      .attr("stroke", d => T["seg-" + d.seg] || T["ink-3"]).attr("stroke-width", 1.5)
      .attr("stroke-dasharray", d => d.isNode ? ((d.confidence || 0) < 0.5 ? "3 3" : null) : ((d.fwdN || 0) < 3 ? "3 3" : null));
    gp.filter(d => d.y > yMax).append("text").attr("class", "pt-clip")
      .attr("x", d => xS(d.x)).attr("y", d => py(d) - rS(d.mcap) - 3).attr("text-anchor", "middle").text("▲");

    const placed = pts.map(d => ({ x0: xS(d.x) - rS(d.mcap) - 1, x1: xS(d.x) + rS(d.mcap) + 1, y0: py(d) - rS(d.mcap) - 1, y1: py(d) + rS(d.mcap) + 1 }));
    placed.push({ x0: mg.l + 2, x1: mg.l + 6 + medTxt.length * 6.2, y0: yS(yMid) - 14, y1: yS(yMid) - 1 });
    const fits = r => r.x0 > mg.l - 2 && r.x1 < W - mg.r + 10 && r.y0 > mg.t - 12 && r.y1 < H - mg.b - 2 && !placed.some(p => !(r.x1 < p.x0 || r.x0 > p.x1 || r.y1 < p.y0 || r.y0 > p.y1));
    const byPriority = [...pts].sort((a, b) => b.mcap - a.mcap);
    const maxLabels = mode === "node" ? (narrow ? 6 : 14) : pts.length;
    const cap = narrow ? 18 : 30;
    const labels = [];
    for (const d of byPriority) {
      if (labels.length >= maxLabels) break;
      const short = d.name.length > cap ? Dashboard.shorten(d.name, cap - 1).text : d.name;
      const w = short.length * 6.0 + 2, h = 13;
      const cx = xS(d.x), cy = py(d), r = rS(d.mcap) + 4;
      const cands = [
        { x: cx + r, y: cy + 4, anchor: "start" }, { x: cx - r, y: cy + 4, anchor: "end" },
        { x: cx, y: cy - r - 2, anchor: "middle" }, { x: cx, y: cy + r + 10, anchor: "middle" },
        { x: cx + r, y: cy - r, anchor: "start" }, { x: cx - r, y: cy - r, anchor: "end" },
        { x: cx + r, y: cy + r + 8, anchor: "start" }, { x: cx - r, y: cy + r + 8, anchor: "end" },
      ];
      for (const c of cands) {
        const x0 = c.anchor === "start" ? c.x : c.anchor === "end" ? c.x - w : c.x - w / 2;
        const rect = { x0, x1: x0 + w, y0: c.y - h + 3, y1: c.y + 3 };
        if (fits(rect)) { placed.push(rect); labels.push({ d, ...c, text: short }); break; }
      }
    }
    svg.append("g").selectAll("text").data(labels).join("text")
      .attr("class", "pt-lbl").attr("x", l => l.x).attr("y", l => l.y)
      .attr("text-anchor", l => l.anchor).text(l => l.text);
    const unlabelled = pts.length - labels.length;

    wrap.appendChild(svg.node());
    {
      const bits = [];
      if (unlabelled > 0) bits.push(`${unlabelled} dot${unlabelled === 1 ? "" : "s"} left unlabelled to keep the chart readable; hover or tap any of them.`);
      if (clipped.length) bits.push(`${clipped.length} dot${clipped.length === 1 ? "" : "s"} marked ▲ sit above the axis (up to ${U.num(rawMax, 0)}x) and are pinned to the top edge.`);
      if (xMin > 0) bits.push(`The score axis starts at ${xMin}, below the lowest plotted score.`);
      if (skipped.length) bits.push(`Not plotted: ${U.esc(skipped.join("; "))}.`);
      if (bits.length) wrap.insertAdjacentHTML("beforeend", `<p class="scatter-foot">${bits.join(" ")}</p>`);
    }

    const tip = document.createElement("div");
    tip.className = "scatter-tip";
    tip.hidden = true;
    wrap.appendChild(tip);
    const show = (ev, d) => {
      const b = Dashboard.band(d.x);
      let h = "<strong>" + U.esc(d.name) + "</strong>";
      if (d.isNode && d.layerName) h += '<br><span class="st-sub">' + U.esc(d.layerName) + "</span>";
      h += `<br>Constraint score: <b>${d.x}</b> ${b.word.toLowerCase()}`;
      const c = d.isNode ? d.confidence : d.avgConf;
      if (c != null) h += ` <span class="st-sub">${Dashboard.evidence(c).toLowerCase()} (${Math.round(c * 100)}%)</span>`;
      if (d.isNode && d.inputs) {
        const IM = Dashboard.INPUT_META;
        const known = Object.keys(IM).filter(k => d.inputs[k] != null);
        h += `<div class="st-inputs">${known.map(k => `${IM[k].name} ${U.num(d.inputs[k], 2)}`).join(" · ")}</div>`;
      }
      if (!d.isNode) {
        if (d.fillPct != null) h += "<br>Capacity in use: " + (d.fillPct > 120 ? ">100" : U.num(Math.min(d.fillPct, 100), 0)) + "%";
        if (d.gap != null) h += "<br>Demand vs capacity growth: " + Dashboard.signed(d.gap) + " pts a year";
      }
      h += "<br>Valuation: " + U.num(d.y, 1) + "x forward P/E" + (d.y > yMax ? ' <span class="st-sub">above the top of the axis</span>' : "");
      if (!d.isNode && d.fwdN) h += ` <span class="st-sub">median of ${d.fwdN}${d.fwdN < 3 ? ", too few to lean on" : ""}</span>`;
      h += "<br>Market cap: " + U.fmtVal(d.mcap, "USD_bn");
      h += `<br><span class="st-sub">Click to open the ${d.isNode ? "company" : "layer"} panel</span>`;
      tip.innerHTML = h;
      tip.hidden = false;
      move(ev);
    };
    const move = ev => {
      const rect = wrap.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = ev.clientX - rect.left + 14;
      if (left + tw > rect.width - 6) left = ev.clientX - rect.left - tw - 14;
      let top = ev.clientY - rect.top - 10;
      if (top + th > rect.height - 6) top = rect.height - th - 6;
      tip.style.left = Math.max(6, left) + "px";
      tip.style.top = Math.max(6, top) + "px";
    };
    gp.on("mouseenter", show).on("mousemove", move).on("mouseleave", () => { tip.hidden = true; });
  },

  /* ---- sparkline with axes ---- */
  spark(row, colour) {
    const pts = row.points || [];
    if (pts.length < 2) return "";
    const ys = pts.map(p => p[1]);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const W = 260, H = 48, padL = 2, padR = 54, padT = 8, padB = 12;
    const sx = i => padL + (i / (pts.length - 1)) * (W - padL - padR);
    const sy = v => maxY === minY ? (H - padB + padT) / 2 : (H - padB) - ((v - minY) / (maxY - minY)) * (H - padT - padB);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(" ");
    const area = `${line} L${sx(pts.length - 1).toFixed(1)},${(H - padB).toFixed(1)} L${sx(0).toFixed(1)},${(H - padB).toFixed(1)} Z`;
    const first = pts[0], last = pts[pts.length - 1];
    const f = v => U.fmtVal(v, row.unit);
    const delta = first[1] ? (last[1] - first[1]) / Math.abs(first[1]) * 100 : null;
    const gutter = W - padR + 6;
    return `<svg viewBox="0 0 ${W} ${H}" class="spark-svg" role="img" aria-label="${U.esc(row.name)} ${U.esc(row.key.replace(/_/g, " "))}, ${first[0]} ${f(first[1])} to ${last[0]} ${f(last[1])}">
      <line class="spark-base" x1="${padL}" y1="${(H - padB).toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${(H - padB).toFixed(1)}"></line>
      <path d="${area}" fill="${colour}" fill-opacity="0.12"></path>
      <path d="${line}" fill="none" stroke="${colour}" stroke-width="1.8"></path>
      <circle cx="${sx(0).toFixed(1)}" cy="${sy(first[1]).toFixed(1)}" r="2" fill="${colour}" fill-opacity="0.5"></circle>
      <circle cx="${sx(pts.length - 1).toFixed(1)}" cy="${sy(last[1]).toFixed(1)}" r="2.8" fill="${colour}"></circle>
      <text class="spark-ax" x="${gutter}" y="${(sy(maxY) + 3).toFixed(1)}">${U.esc(f(maxY))}</text>
      ${maxY === minY ? "" : `<text class="spark-ax" x="${gutter}" y="${(sy(minY) + 3).toFixed(1)}">${U.esc(f(minY))}</text>`}
      <text class="spark-ax x" x="${padL}" y="${H - 2}">${U.esc(String(first[0]))}</text>
      <text class="spark-ax x" x="${(W - padR).toFixed(1)}" y="${H - 2}" text-anchor="end">${U.esc(String(last[0]))}</text>
      ${delta == null ? "" : `<text class="spark-ax d ${delta >= 0 ? "up" : "down"}" x="${gutter}" y="${H - 2}">${delta >= 0 ? "+" : "−"}${U.num(Math.abs(delta), 0)}%</text>`}
    </svg>`;
  },
  sparkRows(layerId, colour) {
    const rows = (APP.data.views.dashboard || {})[layerId] || [];
    if (!rows.length) return "";
    return `<div class="spark2">${rows.map(r => `<div class="s-row">
      <div class="s-head"><span class="s-name">${U.esc(r.name)}</span><span class="s-key">${U.esc(r.key.replace(/_/g, " "))}${r.unit ? ` · ${U.esc(U.unitLabel(r.unit) || r.unit)}` : ""}</span></div>
      ${Dashboard.spark(r, colour)}
    </div>`).join("")}</div>`;
  },

  /* ---- layer card: four numbers, signals, one risk; the rest folded ---- */
  card(lay) {
    const t = lay.totals || {};
    const seg = U.segment(lay.kind);
    const col = `var(--seg-${seg})`;
    const nodes = (APP.idx.byLayer[lay.id] || []).filter(n => n.bn && n.bn.effective != null).sort((a, b) => b.bn.effective - a.bn.effective).slice(0, 4);
    const conf = Dashboard.layerConf(lay.id);
    const fill = Dashboard.fillOf(lay);
    const scored = lay.score != null;
    const b = Dashboard.band(lay.score);
    const explain = scored ? Dashboard.whatWouldChange(lay) : Dashboard.whyNoScore(lay);
    const fin = t.fin || {};
    const gap = Dashboard.gapOf(t);
    const lv = Dashboard.live(lay);
    const stat = (l, v, sub, tip, cls) => `<div class="bn-stat${cls ? " " + cls : ""}"${Dashboard.tipAttr(tip)}><div class="l">${l}</div><div class="v">${v}</div>${sub != null ? `<div class="s">${sub}</div>` : ""}</div>`;
    const stats = [
      stat("Capacity in use", fill.pct == null ? "–" : fill.text, fill.pct == null ? "not measured" : "", `${fill.note} ${Dashboard.stamp(lay, "fill_pct")}`.trim()),
      stat("Demand vs capacity", gap == null ? "–" : `${Dashboard.signed(gap)} pts`, gap == null ? "not measured" : gap < 0 ? "demand faster" : "capacity faster", gap == null ? "Needs both a capacity and a demand growth rate." : `Capacity ${Dashboard.signed(t.capacity_growth_pct_yr)}% a year against demand ${Dashboard.signed(t.demand_growth_pct_yr)}% a year.`, gap != null && gap < 0 ? "neg" : ""),
      stat("Valuation", fin.pe_fwd_median != null ? `${U.num(fin.pe_fwd_median, 1)}x` : "–", fin.pe_fwd_median != null ? (fin.pe_fwd_n < 3 ? `${fin.pe_fwd_n} compan${fin.pe_fwd_n === 1 ? "y" : "ies"} only` : "forward P/E") : "none listed", `Median forward P/E of ${fin.pe_fwd_n || 0} listed companies, as of the build.`, fin.pe_fwd_median != null && fin.pe_fwd_n < 3 ? "warn" : ""),
      lv ? stat("Market cap", `<span class="live-num">${U.fmtVal(lv.m, "USD_bn")}</span>`, Live.chg(lv.c), Dashboard.liveTip(lv))
        : stat("Market cap", fin.mcap_sum_usd_bn ? U.fmtVal(fin.mcap_sum_usd_bn, "USD_bn") : "–", fin.mcap_sum_usd_bn ? "at build" : "none listed", "Combined market cap of the listed companies, as of the build."),
    ].join("");
    const r = Dashboard.riskSummary(lay);
    const growthStamps = [Dashboard.stamp(lay, "capacity_growth_pct_yr"), Dashboard.stamp(lay, "demand_growth_pct_yr")].filter(Boolean);
    const kv = [
      t.capacity_total ? `<dt>Tracked capacity</dt><dd>${Fmt.qty(t.capacity_total, t.unit)}${t.pipeline_growth_pct_2y != null ? `, ${Fmt.growth(t.pipeline_growth_pct_2y)} planned by ${t.pipeline_horizon}` : ""}</dd>` : "",
      t.hhi != null ? `<dt>Supplier concentration</dt><dd>HHI ${U.num(t.hhi, 0)} of 10,000; top three hold ${U.num(t.top3_share_pct, 0)}% (in its most concentrated market)</dd>` : "",
      t.lead_time_weeks ? `<dt>Lead time</dt><dd>${U.num(t.lead_time_weeks, 0)} weeks</dd>` : "",
      t.backlog_usd_bn ? `<dt>Backlog</dt><dd>${U.fmtVal(t.backlog_usd_bn, "USD_bn")}</dd>` : "",
      t.relief_year ? `<dt>Relief year</dt><dd>${t.relief_year}</dd>` : "",
      fin.mcap_sum_usd_bn ? `<dt>Market cap at build</dt><dd>${U.fmtVal(fin.mcap_sum_usd_bn, "USD_bn")}${fin.pe_fwd_wavg != null ? `; forward P/E weighted by market cap ${U.num(fin.pe_fwd_wavg, 1)}x` : ""}</dd>` : "",
      fill.pct != null && Dashboard.stamp(lay, "fill_pct") ? `<dt>Capacity in use</dt><dd>${U.esc(Dashboard.stamp(lay, "fill_pct").replace(/^[^:]+: /, ""))}</dd>` : "",
      growthStamps.length ? `<dt>Growth figures</dt><dd>${U.esc(growthStamps.join("; "))}</dd>` : "",
      t.n_est_only != null ? `<dt>Data coverage</dt><dd>${t.n_nodes - t.n_est_only} of ${t.n_nodes} entries with a market cap or capacity figure${t.grade_mix ? `<br><span class="bn-grades">${["A", "B", "C", "D"].map(g => `<span title="${U.esc(U.gradeName(g))}">${U.gradeChip(g)} ${t.grade_mix[g] || 0}</span>`).join(" ")}</span>` : ""}</dd>` : "",
    ].join("");
    return `<article class="bn-card" id="card-${lay.id}">
      <div class="bn-card-h">
        <div class="bn-card-t"><i class="dot" style="background:${col}"></i><h3><button class="bn-card-name" data-layer="${lay.id}" title="Open the layer panel">${U.esc(lay.name)}</button></h3></div>
        <div class="bn-card-score band-${b.cls}"${Dashboard.tipAttr(scored && conf ? `Score ${Dashboard.fmtScore(lay.score)} of 5. ${Dashboard.evidence(conf.mean)}: known signals carry ${Math.round(conf.mean * 100)}% of the weight on average, across ${conf.n} of ${conf.of} entries.` : "")}>${scored ? `<b>${Dashboard.fmtScore(lay.score)}</b><span>${b.word}</span>` : `<span>Not scored</span>`}</div>
      </div>
      ${scored ? `<div class="bn-strack big band-${b.cls}"><i style="width:${lay.score / 5 * 100}%"></i></div>` : ""}
      <p class="bn-desc">${lay.description ? U.esc(lay.description) : ""}${conf ? ` <span class="bn-card-conf">${Dashboard.evidence(conf.mean)} (${Math.round(conf.mean * 100)}%).</span>` : !scored ? ` <span class="bn-card-conf">Too little data to score yet.</span>` : ""}</p>
      <div class="bn-stats">${stats}</div>
      ${Dashboard.signalsHtml(lay)}
      ${r.top ? `<div class="bn-card-risk"><div class="bn-k">Biggest risk · <span class="sev sev-${r.top.severity}">${Dashboard.SEV_WORD[r.top.severity] || r.top.severity}</span></div><p>${U.esc(r.top.text)} ${Dashboard.srcLink(r.top)}</p></div>` : ""}
      <details class="bn-more"><summary>More detail${r.n > 1 ? `, ${r.n - 1} more risk${r.n - 1 === 1 ? "" : "s"}` : ""}</summary>
        ${Widgets.growth(t.capacity_growth_pct_yr, t.demand_growth_pct_yr, col)}
        ${r.n > 1 ? `<ul class="bn-rall">${r.sorted.slice(1).map(x => `<li><span class="sev sev-${x.severity}">${Dashboard.SEV_WORD[x.severity] || x.severity}</span><span>${U.esc(x.text)} ${Dashboard.srcLink(x)}</span></li>`).join("")}</ul>` : ""}
        ${Dashboard.sparkRows(lay.id, col)}
        ${nodes.length ? `<div><div class="bn-k">Most constrained entries</div><div class="chips">${nodes.map(n => `<button class="chip ${!(n.fin && n.fin.mcap) && !(n.cap && n.cap.cur) ? "est" : ""}" data-go="${n.id}" title="${U.esc(n.name)}: constraint score ${n.bn.effective}${n.bn.confidence != null ? `, known signals carry ${Math.round(n.bn.confidence * 100)}% of the weight` : ""}">${U.esc(n.name)}<span class="n">${n.bn.effective}</span></button>`).join("")}</div></div>` : ""}
        ${explain ? `<div class="dash-missing${scored ? "" : " none"}">${explain}</div>` : ""}
        <dl class="kv">${kv}</dl>
      </details>
    </article>`;
  },

  /* ---- main render ---- */
  render() {
    const el = U.$("#view-bottlenecks");
    const g = APP.data;
    Dashboard.hookLive();
    const layers = [...g.layers].filter(l => l.kind !== "capital");
    Dashboard.doSort(layers);
    const scDesc = Dashboard.scatterMode === "node"
      ? "Each dot is a company: constraint score across, its forward P/E up, size is market cap. A dashed outline means the score rests on thin data."
      : "Each dot is a layer: constraint score across, median forward P/E up, size is the combined market cap of its listed companies. Dashed means fewer than three companies behind the median. The shaded corner is tight but valued below the median.";
    el.innerHTML = `<div class="container bn">
      ${Dashboard.headline(layers)}
      ${Dashboard.rankList(layers)}
      ${Dashboard.explainer()}
      <div class="bn-chart" id="dash-scatter"><div class="scatter-head"><h3>Is the squeeze priced in?</h3><label class="scatter-toggle">Show <select id="scatter-mode"><option value="layer"${Dashboard.scatterMode === "layer" ? " selected" : ""}>layers</option><option value="node"${Dashboard.scatterMode === "node" ? " selected" : ""}>companies</option></select></label></div><p>${scDesc}</p></div>
      <div class="bn-sec-h bn-cards-h"><h3>Layer by layer</h3><p class="bn-sec-note">Same order as the ranking. Click a name to open the layer's full panel.</p></div>
      <div class="bn-cards">${layers.map(l => Dashboard.card(l)).join("")}</div>
    </div>`;
    Dashboard.scatter(U.$("#dash-scatter"), layers);
    Dashboard.wire(el);
  },

  /* re-render on each live update while this view is showing */
  hookLive() {
    if (Dashboard._liveHooked || typeof Live === "undefined") return;
    Dashboard._liveHooked = true;
    Live.on(() => {
      if (Dashboard._busy || APP.state.view !== "bottlenecks") return;
      const v = U.$("#view-bottlenecks"); if (!v || !U.$(".bn", v)) return;
      Dashboard.rerender(v); Live.flash(v);
    });
  },

  /* ---- event wiring ---- */
  wire(el) {
    U.$$(".bn-th button[data-sort]", el).forEach(btn => U.on(btn, "click", () => {
      const key = btn.getAttribute("data-sort");
      if (key === Dashboard.sortKey) Dashboard.sortDir = Dashboard.sortDir === "desc" ? "asc" : "desc";
      else { Dashboard.sortKey = key; Dashboard.sortDir = key === "name" ? "asc" : "desc"; }
      Dashboard.rerender(el);
    }));
    const ss = U.$("#bn-sort", el);
    if (ss) U.on(ss, "change", e => { Dashboard.sortKey = e.target.value; Dashboard.sortDir = e.target.value === "name" ? "asc" : "desc"; Dashboard.rerender(el); });
    U.$$("[data-risk]", el).forEach(btn => U.on(btn, "click", () => {
      const id = btn.getAttribute("data-risk");
      Dashboard.open[id] = !Dashboard.open[id];
      Dashboard.rerender(el, `[data-layer-row="${id}"] [data-risk]`);
    }));
    U.$$("[data-scroll]", el).forEach(btn => U.on(btn, "click", e => {
      e.stopPropagation();
      const c = U.$("#card-" + btn.getAttribute("data-scroll"), el);
      if (c) { c.scrollIntoView({ behavior: "smooth", block: "center" }); c.classList.add("flash"); setTimeout(() => c.classList.remove("flash"), 1200); }
    }));
    const ms = U.$("#scatter-mode", el);
    if (ms) U.on(ms, "change", e => { Dashboard.scatterMode = e.target.value; Dashboard.rerender(el, "#scatter-mode"); });
    U.$$("[data-go]", el).forEach(b => U.on(b, "click", () => State.set({ node: b.getAttribute("data-go"), layer: null })));
    U.$$("[data-layer]", el).forEach(b => U.on(b, "click", () => State.set({ layer: b.getAttribute("data-layer"), node: null })));
    if (!Dashboard._rs) {
      let lastW = window.innerWidth;
      Dashboard._rs = U.debounce(() => { if (window.innerWidth === lastW) return; lastW = window.innerWidth; const v = U.$("#view-bottlenecks"); if (v && APP.state.view === "bottlenecks" && U.$("#dash-scatter", v)) Dashboard.rerender(v); }, 250);
      window.addEventListener("resize", Dashboard._rs);
    }
  },

  /* re-render keeping scroll position and, optionally, focus */
  rerender(el, focusSel) {
    const y = window.scrollY, inner = el.scrollTop;
    Dashboard._busy = true;
    try { Dashboard.render(); } finally { Dashboard._busy = false; }
    window.scrollTo(0, y); el.scrollTop = inner;
    if (focusSel) { const f = U.$(focusSel, el); if (f) f.focus({ preventScroll: true }); }
  },
};
/* ---- Demand 2x2 & Countries ---- */

/* Category → super-group mapping for chip grouping */
const D2_CAT_GROUP = {
  coding: "Coding", trading: "Trading & quant", drug_discovery: "Life sciences",
  precision_medicine: "Life sciences", biosolutions: "Life sciences", clinical_ai: "Life sciences",
  ehr: "Life sciences", medtech: "Life sciences", science: "Science",
  chip_design: "Chip design", data_platform: "Data platforms",
  defence_ai: "Defence", defence: "Defence", ai_rnd: "AI R&D",
  autonomous_vehicles: "Robotics & autonomy", humanoid_robotics: "Robotics & autonomy",
  robot_foundation_models: "Robotics & autonomy", industrial_ai: "Robotics & autonomy",
  ops_agents: "Agents & ops", game_engine: "Gaming",
  asset_management: "Finance", investment_management: "Finance", wealth_management: "Finance",
  brokerage: "Finance", fintech: "Finance", banking: "Finance", mortgage_banking: "Finance",
  crypto_exchange: "Finance", energy_trading: "Finance",
  it_services: "IT services", it_consulting: "IT services",
  bpo: "BPO & support", customer_support: "BPO & support",
  back_office: "Enterprise", enterprise_productivity: "Enterprise", productivity: "Enterprise",
  project_management: "Enterprise", erp: "Enterprise", accounting_tax: "Enterprise",
  crm_marketing: "Enterprise", crm_agents: "Enterprise", enterprise_search: "Enterprise",
  document_ai: "Enterprise", communications: "Enterprise",
  consumer: "Consumer", consumer_ai: "Consumer", consumer_chatbot: "Consumer", consumer_goods: "Consumer",
  education: "Education", freelance: "Freelance", legal: "Legal",
  creative_marketing: "Creative & media", creative: "Creative & media", design: "Creative & media",
  ads: "Advertising", reviews: "Reviews", logistics: "Logistics",
  observability: "DevOps", infrastructure: "DevOps", commerce: "Commerce",
  ai_search: "AI search",
  image_generation: "Gen media", video_generation: "Gen media", voice_ai: "Gen media", music_generation: "Gen media",
};

/* Chain-specific overrides: the robotics chain buys robot-hours, not tokens. */
const D2_CAT_GROUP_BY_CHAIN = {
  robotics: {
    manufacturing: "Factory floors", logistics: "Warehouses & fulfilment",
    fleet: "Mobility fleets", entertainment: "Venues & entertainment",
    retail_care: "Retail & care", defence: "Defence",
  },
};

const D2_NORDICS = ["DNK", "SWE", "NOR", "FIN", "ISL"];

/* Everything the 2x2 says in words, per chain. The AI chain buys tokens; the robotics chain buys
   robot-hours, so the axis names and the quadrant readings change with the chain. */
const D2_COPY = {
  "": {
    title: "Who buys the tokens",
    noun: "companies placed",
    lede: "The companies that pay for AI models, sorted by two questions: does a better model keep paying off for them, and how long does one piece of their work run?",
    unit: "token spending",
    yQ: "Does a better model keep paying off?",
    xQ: "How long does one piece of work run?",
    rows: [
      ["Unbounded", "Yes: more tokens keep buying more revenue or capability. The job is never finished, so the best model is worth its price."],
      ["Bounded", "No: once the task is done correctly, extra quality buys nothing. Buyers drift to the cheapest model that is good enough."],
    ],
    cols: [
      ["Long horizon", "More than about three to four hours of expert time (METR's 80% time horizon). The model must hold context across a whole case, trial or migration."],
      ["Short horizon", "Minutes to hours. The buyer can re-prompt, check the answer and switch model mid-session."],
    ],
    rfLabel: "Share funded by the AI boom",
    rfShort: "funded by AI boom",
    rfWhat: "Share of this buyer's AI spending that is itself paid for by the AI boom: for example, a trading firm whose AI budget comes from AI-driven profits, or an AI start-up spending investors' money. 0% means ordinary business revenue pays for it. Our estimate: no company discloses this.",
    fdLabel: "Needs the newest model",
    fdWhat: "How much the work needs the newest frontier model rather than a cheaper one: high, medium or low.",
    quads: {
      unbounded_long: ["Frontier spenders", "Better models earn more, and each task runs long enough that only a frontier model can hold it. This is the demand that keeps paying for the frontier.", "No company in this build sits here."],
      unbounded_short: ["Volume without lock-in", "Unlimited volume, but each token is worth a capped amount and the buyer can switch model within a session.", "No company in this build sits here."],
      bounded_long: ["Long but finite", "The task is solved once and then the cheapest adequate model wins, but each cycle is long: a tax year, an ERP migration, a legal matter. A thin cell in practice.", "No company in this build sits here."],
      bounded_short: ["Cheapest model wins", "Cost-saving work where demand converges on the cheapest adequate model within months.", "No company in this build sits here."],
    },
    sizeNote: "Larger names are larger companies by market value.",
  },
  robotics: {
    title: "Who buys the robot-hours",
    noun: "deployers placed",
    lede: "The sites and fleets that actually pay for humanoid work, sorted by the same two questions as the AI chain, asked about physical work instead of tokens.",
    unit: "robot budget",
    yQ: "Do more robot-hours keep paying off?",
    xQ: "How long does the same task hold?",
    rows: [
      ["Unbounded", "Robot-hours are the revenue. Every extra hour moves more totes or ships more units, with no ceiling short of end demand."],
      ["Bounded", "The site needs a fixed number of robot-hours. Once a station is staffed, a better robot buys nothing."],
    ],
    cols: [
      ["Long horizon", "The cycle is fixed for years: the same weld, the same part. A policy trained once is enough, so a cheaper, task-specific robot can win."],
      ["Short horizon", "The task is minutes long and changes constantly: a new tote, a new package. The robot has to generalise on the floor."],
    ],
    rfLabel: "Share funded by the AI boom",
    rfShort: "funded by AI boom",
    rfWhat: "Share of this buyer's robot budget that is itself paid for by the AI buildout. Our estimate.",
    fdLabel: "Needs a frontier robot model",
    fdWhat: "How much the deployment needs a frontier robot-foundation model rather than a scripted policy.",
    quads: {
      unbounded_long: ["Open-ended labour", "Hours without a ceiling, on work long and varied enough to need a general model. This is the cell a genuinely general humanoid would create.", "Empty, and that is the finding: nobody yet buys open-ended physical labour by the hour. This cell only opens if one model can hold a long, varied job."],
      unbounded_short: ["Throughput buyers", "Throughput is the revenue and each task is minutes long. The buyer takes every hour it can get but can switch supplier, so robot makers compete on cost per hour.", "No deployer in this build sits here."],
      bounded_long: ["Fixed stations", "A fixed number of stations and a cycle that holds for years. The buyer wants the cheapest robot that clears the cycle. Where every announced Western deployment actually sits.", "No deployer in this build sits here."],
      bounded_short: ["Fixed short tasks", "A fixed amount of short-cycle work. Rare in practice: when short tasks repeat all day, throughput usually is the revenue.", "Empty in this build: short-cycle repetitive work tends to count as throughput, which puts it in the row above."],
    },
    sizeNote: "Only listed parents carry a market value, so all names are drawn at one size.",
  },
};

/* A small hover and tap tooltip for any element with data-tip, shared by the Demand and Countries
   views. Bound once per container; the container survives re-renders. */
const KTip = {
  _bound: new Set(),
  el() {
    let t = document.getElementById("k-tip");
    if (!t) { t = document.createElement("div"); t.id = "k-tip"; t.className = "k-tip"; t.hidden = true; t.setAttribute("role", "tooltip"); document.body.appendChild(t); }
    return t;
  },
  show(ref) {
    const html = ref.getAttribute("data-tip-html") ? ref.getAttribute("data-tip-html") : U.esc(ref.getAttribute("data-tip") || "");
    if (!html) return;
    const t = KTip.el(); t.innerHTML = html; t.hidden = false;
    const r = ref.getBoundingClientRect();
    const tw = t.offsetWidth, th = t.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2; let top = r.bottom + 8;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    if (top + th > window.innerHeight - 8) top = Math.max(8, r.top - th - 8);
    t.style.left = left + "px"; t.style.top = top + "px";
  },
  hide() { const t = document.getElementById("k-tip"); if (t) t.hidden = true; },
  bind(el) {
    if (KTip._bound.has(el.id)) return;
    KTip._bound.add(el.id);
    const find = e => e.target && e.target.closest ? e.target.closest("[data-tip],[data-tip-html]") : null;
    el.addEventListener("pointerover", e => { if (e.pointerType === "touch") return; const b = find(e); if (b) KTip.show(b); });
    el.addEventListener("pointerout", e => { if (find(e)) KTip.hide(); });
    el.addEventListener("focusin", e => { const b = find(e); if (b) KTip.show(b); });
    el.addEventListener("focusout", () => KTip.hide());
    /* a tap on a phone shows the tip; a second tap elsewhere hides it */
    el.addEventListener("click", e => { const b = find(e); if (b && !b.closest("button,a,select,label")) { KTip.show(b); e.stopPropagation(); } else KTip.hide(); });
    document.addEventListener("click", e => { if (!el.contains(e.target)) KTip.hide(); });
    el.addEventListener("scroll", () => KTip.hide(), { passive: true });
  },
};

const Demand = {
  _filter: { country: "", own: "", fd: "", dk: false, cat: "" },
  _detail: null,      /* null = auto, true = detail rows, false = chips */
  _hoverBound: false,

  _copy() { return D2_COPY[APP.chain || ""] || D2_COPY[""]; },

  _catOf(n) {
    const over = D2_CAT_GROUP_BY_CHAIN[APP.chain || ""] || {};
    return over[n.cat] || D2_CAT_GROUP[n.cat] || Demand._humanise(n.cat);
  },

  _humanise(s) { return String(s || "Other").replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase()); },

  /* [key, row index, column index]: rows are boundedness, columns are horizon */
  _quadMeta() {
    return [["unbounded_long", 0, 0], ["unbounded_short", 0, 1], ["bounded_long", 1, 0], ["bounded_short", 1, 1]];
  },

  _passes(n) {
    const f = Demand._filter;
    if (f.country && n.hq !== f.country) return false;
    if (f.own && n.own !== f.own) return false;
    if (f.fd && n.fd !== f.fd) return false;
    if (f.cat && Demand._catOf(n) !== f.cat) return false;
    if (f.dk && !D2_NORDICS.includes(n.hq)) return false;
    return true;
  },

  /* Size chips by market cap only when enough of the set carries one; otherwise every chip is
     drawn the same, so the reader does not read meaning into a missing number. */
  _sizeable(v) {
    const withCap = v.filter(n => { const nd = U.nodeOf(n.id); return nd && nd.fin && nd.fin.mcap; }).length;
    return v.length > 0 && withCap / v.length >= 0.4;
  },

  _sizeClass(n) {
    if (!Demand._useSize) return "sz-2";
    const node = U.nodeOf(n.id);
    const mcap = node && node.fin && node.fin.mcap ? node.fin.mcap[0] : null;
    const val = node && node.fin && node.fin.val ? node.fin.val[0] : null;
    const v = mcap || val;
    if (v == null) return "sz-1";
    if (v >= 50) return "sz-3";
    if (v >= 5) return "sz-2";
    return "sz-1";
  },

  _isFlagged(n) {
    const node = U.nodeOf(n.id);
    if (!node || !node.dc || !node.dc.why) return false;
    const w = node.dc.why.toLowerCase();
    return w.startsWith("ambiguous") || w.startsWith("reclassif") || w.includes("flagged");
  },

  _why(n) { const node = U.nodeOf(n.id); return (node && node.dc && node.dc.why) || ""; },

  _ownWord(own) { return own === "public" ? "listed" : own === "subsidiary" ? "subsidiary" : own === "state" ? "state-owned" : "private"; },

  _fdWord(fd) { return fd === "high" ? "high" : fd === "med" ? "medium" : fd === "low" ? "low" : "not rated"; },

  /* The dot carries the AI-boom-funded share: an empty ring at 0%, a full disc at 100%. */
  _rfDot(rf) {
    const p = Math.round((rf ?? 0) * 100);
    return `<i class="rf-dot" style="--p:${p}%"></i>`;
  },

  _chipHtml(n) {
    const node = U.nodeOf(n.id);
    const est = !(node && node.fin && (node.fin.mcap || node.fin.val));
    const flagged = Demand._isFlagged(n);
    const isDk = D2_NORDICS.includes(n.hq);
    const sz = Demand._sizeClass(n);
    const cls = ["chip", "d2-chip", sz, est ? "est" : "", flagged ? "flagged" : "", isDk ? "dk-chip" : ""].filter(Boolean).join(" ");
    return `<button class="${cls}" data-go="${n.id}" data-d2-hover="${n.id}" aria-label="${U.esc(n.name)}">${Demand._rfDot(n.rf)}<span class="nm">${U.esc(n.name)}</span><span class="n">${U.esc(n.hq)}</span></button>`;
  },

  /* Detail row: used when the set is small enough that the reasoning fits on the page. */
  _rowHtml(n) {
    const node = U.nodeOf(n.id);
    const fin = (node && node.fin) || {};
    const flagged = Demand._isFlagged(n);
    const isDk = D2_NORDICS.includes(n.hq);
    const rf = n.rf ?? null;
    const facts = [];
    if (fin.mcap) facts.push(`market value ${U.fmtVal(fin.mcap[0], "USD_bn")}`);
    else if (fin.val) facts.push(`valued at ${U.fmtVal(fin.val[0], "USD_bn")}`);
    if (fin.arr) facts.push(`annual recurring revenue ${U.fmtVal(fin.arr[0], "USD_bn")}`);
    if (fin.pe_fwd) facts.push(`${U.num(fin.pe_fwd[0], 1)}x next year's earnings`);
    if (fin.dd) facts.push(`${U.num(fin.dd[0], 0)}% from 1-year high`);
    const c = Demand._copy();
    return `<button class="d2-row${flagged ? " flagged" : ""}${isDk ? " dk-row" : ""}" data-go="${n.id}" data-d2-hover="${n.id}">
      <span class="d2-row-head"><span class="d2-row-name">${U.esc(n.name)}${flagged ? `<span class="d2-flag">?</span>` : ""}</span><span class="d2-row-meta">${U.esc(n.hq)} · ${U.esc(Demand._ownWord(n.own))} · ${U.esc(c.fdLabel.toLowerCase())}: ${U.esc(Demand._fdWord(n.fd))}</span></span>
      ${rf != null ? `<span class="d2-rf"><span class="d2-rf-track"><i style="width:${Math.round(rf * 100)}%"></i></span><span class="d2-rf-v">${Math.round(rf * 100)}% ${U.esc(c.rfShort)}</span></span>` : ""}
      ${facts.length ? `<span class="d2-row-facts">${U.esc(facts.join(" · "))}</span>` : ""}
      ${Demand._why(n) ? `<span class="d2-row-why">${U.esc(Demand._why(n))}</span>` : ""}
    </button>`;
  },

  _median(arr) { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; },

  _quadStats(items) {
    const c = Demand._copy();
    const nodes = items.map(n => U.nodeOf(n.id)).filter(Boolean);
    const mcaps = nodes.map(nd => nd.fin && nd.fin.mcap ? nd.fin.mcap[0] : null).filter(v => v != null);
    const sumMcap = mcaps.reduce((s, v) => s + v, 0);
    const listed = items.filter(n => n.own === "public").length;
    const medRf = Demand._median(items.map(n => n.rf).filter(v => v != null));
    const medDd = Demand._median(nodes.map(nd => nd.fin && nd.fin.dd ? nd.fin.dd[0] : null).filter(v => v != null));
    const st = (tip, v, l) => `<span class="quad-stat" data-tip="${U.esc(tip)}"><b>${v}</b> ${l}</span>`;
    let html = st(`${listed} listed on a stock exchange, ${items.length - listed} private or subsidiaries`, items.length, items.length === 1 ? "company" : "companies");
    if (sumMcap > 0) html += st(`Sum of market values for the ${mcaps.length} listed companies in this cell`, U.fmtVal(sumMcap, "USD_bn"), "listed value");
    if (medRf != null) html += st(`Median ${c.rfLabel.charAt(0).toLowerCase() + c.rfLabel.slice(1)}. ${c.rfWhat}`, U.num(medRf * 100, 0) + "%", c.rfShort);
    if (medDd != null) html += st("Median fall in share price from its 1-year high, for listed names with a price history", U.num(medDd, 0) + "%", "from 1y high");
    return `<div class="quad-stats">${html}</div>`;
  },

  _groupedChips(items, detail) {
    const render = detail ? Demand._rowHtml : Demand._chipHtml;
    const wrapCls = detail ? "d2-rows" : "chips d2-chips";
    const groups = {};
    for (const n of items) {
      const g = Demand._catOf(n);
      (groups[g] = groups[g] || []).push(n);
    }
    const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    if (sorted.length <= 1) {
      const arr = items.slice().sort(Demand._byRf);
      return `<div class="${wrapCls}">${arr.map(render).join("")}</div>`;
    }
    return sorted.map(([cat, arr]) => {
      arr.sort(Demand._byRf);
      return `<div class="cat-group"><div class="cat-head"><span>${U.esc(cat)}</span><span class="cat-n">${arr.length}</span></div><div class="${wrapCls}">${arr.map(render).join("")}</div></div>`;
    }).join("");
  },

  _byRf(a, b) { return (b.rf ?? 0) - (a.rf ?? 0) || a.name.localeCompare(b.name); },

  _hoverHtml(n) {
    const node = U.nodeOf(n.id);
    if (!node) return "";
    const dc = node.dc || {};
    const fin = node.fin || {};
    const c = Demand._copy();
    const mcap = fin.mcap ? U.fmtVal(fin.mcap[0], "USD_bn") : null;
    const peFwd = fin.pe_fwd ? U.num(fin.pe_fwd[0], 1) + "x" : null;
    const dd = fin.dd ? U.num(fin.dd[0], 0) + "%" : null;
    const arr = fin.arr ? U.fmtVal(fin.arr[0], "USD_bn") : null;
    const val = fin.val ? U.fmtVal(fin.val[0], "USD_bn") : null;
    const flagged = Demand._isFlagged(n);
    let html = `<h4>${U.esc(n.name)}</h4>`;
    html += `<div class="h-meta"><span>${U.esc(n.hq)}</span><span>${U.esc(Demand._ownWord(n.own))}</span><span>${U.esc(Demand._catOf(n))}</span>${flagged ? `<span class="d2-hover-flag">placement open to debate</span>` : ""}</div>`;
    if (dc.why) html += `<p class="h-why">${U.esc(dc.why)}</p>`;
    html += `<dl class="h-kv">`;
    html += `<dt>${U.esc(c.rfLabel)}</dt><dd>${n.rf != null ? U.num(n.rf * 100, 0) + "% <span class='h-est'>our estimate</span>" : "n/a"}</dd>`;
    html += `<dt>${U.esc(c.fdLabel)}</dt><dd>${U.esc(Demand._fdWord(n.fd))}</dd>`;
    const lq = typeof Live !== "undefined" && Live.ready ? Live.node(n.id) : null;
    if (mcap) html += `<dt>Market value${lq ? " (live)" : ""}</dt><dd>${mcap}</dd>`;
    if (lq) html += `<dt>Today</dt><dd>${Live.chg(lq.c)}</dd>`;
    if (val && !mcap) html += `<dt>Last private valuation</dt><dd>${val}</dd>`;
    if (arr) html += `<dt>Annual recurring revenue</dt><dd>${arr}</dd>`;
    if (peFwd) html += `<dt>Price / next year's earnings</dt><dd>${peFwd}</dd>`;
    if (dd) html += `<dt>Change from 1-year high</dt><dd>${dd}</dd>`;
    html += `</dl><div class="h-foot">${lq ? `Live price ${U.esc(lq.sym)}, updated ${U.esc(Live.ago(lq.ts))}. ` : ""}Click for sources and the full profile.</div>`;
    return html;
  },

  _tip() {
    let tip = document.getElementById("d2-hover");
    if (!tip) { tip = document.createElement("div"); tip.id = "d2-hover"; tip.className = "d2-hover"; tip.hidden = true; document.body.appendChild(tip); }
    return tip;
  },

  _showTip(btn) {
    const id = btn.getAttribute("data-d2-hover");
    const v = (APP.data.views.demand2x2 || []).find(n => n.id === id);
    if (!v) return;
    const tip = Demand._tip();
    tip.innerHTML = Demand._hoverHtml(v);
    tip.hidden = false;
    Demand._positionHover(tip, btn);
  },

  _hideTip() { const tip = document.getElementById("d2-hover"); if (tip) tip.hidden = true; },

  /* Bound once on the view container: the container survives re-renders, so re-binding on every
     render would stack a new set of listeners each time a filter changed. */
  _attachHover(el) {
    if (Demand._hoverBound) return;
    Demand._hoverBound = true;
    const find = e => e.target && e.target.closest ? e.target.closest("[data-d2-hover]") : null;
    el.addEventListener("pointerover", e => { if (e.pointerType === "touch") return; const b = find(e); if (b) Demand._showTip(b); }, true);
    el.addEventListener("pointermove", e => { const b = find(e); const tip = document.getElementById("d2-hover"); if (b && tip && !tip.hidden) Demand._positionHover(tip, b); }, true);
    el.addEventListener("pointerout", e => { if (find(e)) Demand._hideTip(); }, true);
    el.addEventListener("focusin", e => { const b = find(e); if (b && b.matches(":focus-visible")) Demand._showTip(b); });
    el.addEventListener("focusout", e => { if (find(e)) Demand._hideTip(); });
    el.addEventListener("click", e => { const b = find(e); if (b) Demand._hideTip(); });
    window.addEventListener("scroll", () => Demand._hideTip(), true);
  },

  _positionHover(tip, ref) {
    const r = ref.getBoundingClientRect();
    let left = r.left; let top = r.bottom + 6;
    const tw = tip.offsetWidth; const th = tip.offsetHeight;
    if (left + tw > window.innerWidth - 12) left = window.innerWidth - tw - 12;
    if (left < 8) left = 8;
    if (top + th > window.innerHeight - 8) top = Math.max(8, r.top - th - 6);
    tip.style.left = left + "px"; tip.style.top = top + "px";
  },

  /* The reading key: two axis cards, each a small two-ended scale, beside a mini 2x2. */
  _axesHtml(counts) {
    const c = Demand._copy();
    const q = Demand._quadMeta();
    const mini = `<div class="d2-mini" aria-hidden="true">${q.map(([k]) => `<span class="d2-mini-cell q-${k}"><b>${counts[k] || 0}</b><em>${U.esc(c.quads[k][0])}</em></span>`).join("")}</div>`;
    const axis = (cls, label, q2, ends) => `<div class="d2-axis-card ${cls}">
        <div class="d2-axis-q"><span class="d2-axis-tag">${label}</span>${U.esc(q2)}</div>
        <div class="d2-scale">${ends.map(([k, v], i) => `<div class="d2-end e${i}"><b>${U.esc(k)}</b><span>${U.esc(v)}</span></div>`).join("")}</div>
      </div>`;
    return `<section class="d2-key" aria-label="How to read the grid">
      ${mini}
      ${axis("ax-y", "Rows", c.yQ, c.rows)}
      ${axis("ax-x", "Columns", c.xQ, c.cols)}
    </section>`;
  },

  _legendHtml(useSize) {
    const c = Demand._copy();
    const items = [
      `<span class="d2-lg" data-tip="${U.esc(c.rfWhat)}"><i class="rf-dot" style="--p:0%"></i><i class="rf-dot" style="--p:50%"></i><i class="rf-dot" style="--p:100%"></i> filled share = ${U.esc(c.rfLabel.charAt(0).toLowerCase() + c.rfLabel.slice(1))}</span>`,
      useSize ? `<span class="d2-lg" data-tip="Names are drawn in three sizes by market value or last private valuation: under $5bn, $5bn to $50bn, above $50bn."><i class="d2-lg-sz"></i> ${U.esc(c.sizeNote)}</span>` : `<span class="d2-lg">${U.esc(c.sizeNote)}</span>`,
      `<span class="d2-lg" data-tip="A dashed outline means no market value or valuation is on file for this company."><i class="d2-lg-est"></i> no market value on file</span>`,
      `<span class="d2-lg" data-tip="A judgement call that could reasonably go either way. Hover the name to read why."><i class="d2-lg-flag">?</i> placement open to debate</span>`,
    ];
    return `<div class="d2-legend">${items.join("")}<span class="d2-lg d2-lg-hint">Hover a name for the reasoning; click it for sources.</span></div>`;
  },

  render() {
    const el = U.$("#view-demand");
    const v = APP.data.views.demand2x2 || [];
    const c = Demand._copy();
    const quads = Demand._quadMeta();
    Demand._useSize = Demand._sizeable(v);

    const countries = [...new Set(v.map(n => n.hq))].sort();
    const cats = [...new Set(v.map(n => Demand._catOf(n)))].sort();
    const hasNordic = v.some(n => D2_NORDICS.includes(n.hq));
    const f = Demand._filter;

    const filtered = v.filter(Demand._passes);
    const detail = Demand._detail == null ? filtered.length <= 14 : Demand._detail;
    const active = !!(f.country || f.own || f.fd || f.cat || f.dk);

    const opt = (val, label, cur) => `<option value="${U.esc(val)}"${val === cur ? " selected" : ""}>${U.esc(label)}</option>`;

    let toolbar = `<div class="d2-toolbar"><span class="d2-tb-lab">Filter</span>`;
    toolbar += `<label><span>Country</span><select id="d2-country"><option value="">All</option>${countries.map(x => opt(x, x, f.country)).join("")}</select></label>`;
    toolbar += `<label><span>Ownership</span><select id="d2-own"><option value="">All</option>${opt("public", "Listed", f.own)}${opt("private", "Private", f.own)}${opt("subsidiary", "Subsidiary", f.own)}</select></label>`;
    toolbar += `<label data-tip="${U.esc(c.fdWhat)}"><span>${U.esc(c.fdLabel)}</span><select id="d2-fd"><option value="">All</option>${opt("high", "High", f.fd)}${opt("med", "Medium", f.fd)}${opt("low", "Low", f.fd)}</select></label>`;
    toolbar += `<label><span>Category</span><select id="d2-cat"><option value="">All</option>${cats.map(x => opt(x, x, f.cat)).join("")}</select></label>`;
    if (hasNordic) toolbar += `<label class="check"><input type="checkbox" id="d2-dk"${f.dk ? " checked" : ""}> Nordic only</label>`;
    toolbar += `<span class="d2-tb-end"><span class="d2-count">${filtered.length} of ${v.length}</span>`;
    toolbar += `<button class="d2-btn" type="button" id="d2-layout" aria-pressed="${detail}">${detail ? "Compact view" : "Show reasons"}</button>`;
    if (active) toolbar += `<button class="d2-btn" type="button" id="d2-reset">Clear filters</button>`;
    toolbar += `</span></div>`;

    /* headline: numbers a first-time reader can carry away */
    const unb = filtered.filter(n => n.quadrant.startsWith("unbounded")).length;
    const flagged = filtered.filter(Demand._isFlagged).length;
    const rfs = filtered.map(n => n.rf).filter(x => x != null);
    const avgRf = rfs.length ? rfs.reduce((s, x) => s + x, 0) / rfs.length : null;
    const sum = (cls, tip, l, val, s) => `<div class="d2-sum ${cls}" data-tip="${U.esc(tip)}" tabindex="0"><div class="v">${val}</div><div class="l">${l}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;
    const summary = `<div class="d2-summary">
      ${sum("", `Buyers placed on the grid. ${(APP.data.views.demand2x2_meta || {}).n_in_layer || v.length} nodes sit in this layer; the others are market reference series, not buyers.`, U.esc(c.noun), filtered.length, active ? `filtered from ${v.length}` : "")}
      ${sum("", "Share of placed buyers in the top row, where a better model keeps paying off.", "do work where better AI keeps paying", `${filtered.length ? Math.round(unb / filtered.length * 100) : 0}%`, `${unb} of ${filtered.length}`)}
      ${avgRf != null ? sum("", "Simple average across the placed buyers. " + c.rfWhat, `average ${U.esc(c.rfLabel.charAt(0).toLowerCase() + c.rfLabel.slice(1))}`, `${Math.round(avgRf * 100)}%`, "our estimate") : ""}
      ${flagged ? sum("warn", "Placements where the reasoning could reasonably go either way. They carry a ? on the grid.", "placements open to debate", flagged, "") : ""}
    </div>`;

    const counts = {}; for (const [k] of quads) counts[k] = filtered.filter(n => n.quadrant === k).length;

    const grid = `<div class="d2-frame">
      <div class="d2-axis-top"><span class="ax-l">${U.esc(c.cols[0][0])}</span><span class="ax-x-q">${U.esc(c.xQ)}</span><span class="ax-r">${U.esc(c.cols[1][0])}</span></div>
      <div class="d2-axis-left"><span class="ax-t">${U.esc(c.rows[0][0])}</span><span class="ax-b">${U.esc(c.rows[1][0])}</span></div>
      <div class="grid2 d2-grid">${quads.map(([q, ri, ci]) => {
        const items = filtered.filter(n => n.quadrant === q);
        const [name, txt, emptyTxt] = c.quads[q];
        return `<section class="quad q-${q}${items.length ? "" : " empty"}">
          <header class="quad-head"><h3>${U.esc(name)}</h3><span class="quad-n">${items.length}</span></header>
          <div class="quad-tags"><span class="qt qt-y${ri ? " b" : ""}" data-tip="${U.esc(c.rows[ri][1])}">${U.esc(c.rows[ri][0])}</span><span class="qt qt-x${ci ? " s" : ""}" data-tip="${U.esc(c.cols[ci][1])}">${U.esc(c.cols[ci][0])}</span></div>
          <p class="quad-p">${U.esc(items.length ? txt : emptyTxt)}</p>
          ${items.length ? Demand._quadStats(items) + Demand._groupedChips(items, detail) : ""}
        </section>`;
      }).join("")}</div>
    </div>`;

    el.innerHTML = `<div class="container d2-wrap">
      <header class="vh"><h2>${U.esc(c.title)}</h2><p>${U.esc(c.lede)}</p></header>
      ${Demand._axesHtml(counts)}
      ${summary}
      ${toolbar}
      ${Demand._legendHtml(Demand._useSize)}
      ${grid}
      <p class="d2-foot">Both placements are judgement calls with a written reason on every name. The share funded by the AI boom is our estimate throughout, because no AI lab yet discloses who its customers are.</p>
    </div>`;

    const bind = (id, key) => { const s = U.$("#" + id, el); if (s) s.addEventListener("change", () => { Demand._filter[key] = s.type === "checkbox" ? s.checked : s.value; Demand.render(); }); };
    bind("d2-country", "country"); bind("d2-own", "own"); bind("d2-fd", "fd"); bind("d2-cat", "cat"); bind("d2-dk", "dk");
    const resetBtn = U.$("#d2-reset", el);
    if (resetBtn) resetBtn.addEventListener("click", () => { Demand._filter = { country: "", own: "", fd: "", dk: false, cat: "" }; Demand._detail = null; Demand.render(); });
    const layoutBtn = U.$("#d2-layout", el);
    if (layoutBtn) layoutBtn.addEventListener("click", () => { Demand._detail = !detail; Demand.render(); });

    U.$$("[data-go]", el).forEach(b => U.on(b, "click", () => State.set({ node: b.getAttribute("data-go"), layer: null })));
    Demand._attachHover(el);
    KTip.bind(el);
    Demand._hideTip(); KTip.hide();
  },
};

/* Short column headings for the per-layer node counts. Derived where a chain is not listed. */
const CTRY_LAYER_ABBR = {
  minerals_gases: "Min", engineered_materials: "Mat", litho_subsystems: "Lit", semicap: "SCp",
  wafer_fab: "Fab", memory: "Mem", packaging_substrates: "Pkg", accelerators: "Acc",
  networking_optics: "Net", servers_cooling: "Srv", dc_equipment_construction: "DCe",
  power_grid: "Pwr", data_centers: "DC", compute_providers: "Cmp", frontier_labs: "Lab",
  inference_distribution: "Inf", token_consumers: "Con", capital: "Cap",
  rb_mining: "Min", rb_materials: "Mag", rb_machine_tools: "Tool", rb_components: "Cmp",
  rb_sensing_compute: "Sens", rb_integration: "Asm", rb_oems: "OEM", rb_physical_ai: "Lab",
  rb_deployers: "Dep", rb_capital: "Cap",
};

/* The country scorecard: four sub-scores on 0 to 10, weighted into the composite. The weights are
   the scorecard's own; the bar segments are each sub-score times its weight. */
const CTRY_PARTS = [
  ["adoption_score", "Adoption", 0.40, "--ct-adopt", "How widely businesses use AI, 0 to 10. Enterprise AI adoption scaled so 42% scores 10 (Eurostat for European countries; national surveys for the US and UK, which are not like-for-like); elsewhere from usage rankings or judgement."],
  ["compute_score", "Compute", 0.25, "--ct-compute", "Access to AI compute, 0 to 10: twice the 0 to 5 compute-access judgement (5 = hosts frontier compute, 0 = none)."],
  ["fiscal_score", "Fiscal room", 0.20, "--ct-fiscal", "Room in the public finances, 0 to 10: 10 at zero government debt, 0 at debt of 200% of GDP (IMF data)."],
  ["wealth_score", "Wealth", 0.15, "--ct-wealth", "GDP per person, 0 to 10: 10 at $120,000 or more (IMF data)."],
];

const CTRY_NAME_FALLBACK = { THA: "Thailand", SAU: "Saudi Arabia", ARE: "UAE", BRA: "Brazil" };

const CTRY_TIPS = {
  nodes: "Companies, products and markets in this chain headquartered in the country. The colours show which part of the chain they sit in.",
  prod: "Production exposure adds up the country's share of physical production across the chain's tracked markets: 1.0 is the equivalent of one whole market, for example all of the world's ABF film. It only counts companies that carry a production map, so it is a floor, not a census.",
  nc: "Not measured yet: producing companies headquartered here carry no production map, so a zero would describe our coverage, not the country.",
  adopt: "Share of enterprises using AI. Eurostat 2025 for European countries; US and UK from national surveys with different firm-size cut-offs.",
  compute: "Compute access, 0 to 5: a judgement score where 5 means the country hosts frontier compute and 0 means none. Our estimate.",
  debt: "General government gross debt as a share of GDP, 2025 (IMF World Economic Outlook, April 2026).",
  composite: "AI scorecard, 0 to 10: 40% adoption, 25% compute access, 20% fiscal room, 15% wealth. Our estimate, built from official statistics plus judgement.",
  rank: "Rank on the composite among the scored countries.",
  liveM: "Combined market value of the listed companies headquartered here, from live quotes (Yahoo Finance, some delayed 15 to 20 minutes).",
  today: "Today's move in the listed companies headquartered here, weighted by market value, since each market's previous close.",
};

const Country = {
  sortKey: "n_nodes", sortDir: -1,
  _showLayers: false,
  _inChainOnly: true,
  _barSort: "n_nodes",

  _abbr(l) {
    if (CTRY_LAYER_ABBR[l]) return CTRY_LAYER_ABBR[l];
    const ly = U.layerOf(l);
    return ((ly && ly.name) || l).replace(/[^A-Za-z ]/g, "").split(/\s+/).map(w => w[0]).join("").slice(0, 3) || l.slice(0, 3);
  },

  _live(c) { return typeof Live !== "undefined" && Live.ready && c.iso !== "WLD" ? Live.countryToday(c.iso) : null; },

  _label(c) { return c.iso === "WLD" ? "Global markets" : (c.name && c.name !== c.iso ? c.name : (CTRY_NAME_FALLBACK[c.iso] || c.name)); },

  /* Segment totals for one country, in chain order, for the stacked bar. */
  _segs(c) {
    const order = APP.data.views.layer_order;
    const segs = [];
    for (const l of order) {
      const n = c.nodes_by_layer[l] || 0; if (!n) continue;
      const ly = U.layerOf(l); const seg = U.segment(ly.kind);
      const last = segs[segs.length - 1];
      if (last && last.seg === seg) { last.n += n; last.layers.push([ly.name, n]); }
      else segs.push({ seg, n, layers: [[ly.name, n]] });
    }
    return segs;
  },

  _stackTip(c) {
    const rows = APP.data.views.layer_order.filter(l => c.nodes_by_layer[l]).map(l => { const ly = U.layerOf(l); return `<tr><td><i class="ct-sw" style="background:var(--seg-${U.segment(ly.kind)})"></i>${U.esc(ly.name)}</td><td class="num">${c.nodes_by_layer[l]}</td></tr>`; }).join("");
    return `<b>${U.esc(Country._label(c))}</b><span class="k-sub">${c.n_nodes} node${c.n_nodes === 1 ? "" : "s"} by layer</span><table class="k-tbl">${rows}</table>`;
  },

  _prodTip(c) {
    if (c.production_status === "not_covered") return `<b>${U.esc(Country._label(c))}: not measured yet</b><span class="k-sub">${c.producers - c.producers_mapped} of ${c.producers} producing compan${c.producers === 1 ? "y" : "ies"} headquartered here carry no production map, so a zero would describe our coverage, not the country.</span>`;
    return `<b>${U.esc(Country._label(c))}: ${U.num(c.production_exposure, 2)}</b><span class="k-sub">${U.esc(CTRY_TIPS.prod)}</span>`;
  },

  /* Chart 1: headquarters against production, one row per country. */
  _hqProdChart(rows) {
    const key = Country._barSort;
    const prodVal = c => c.production_status === "not_covered" ? -1 : (c.production_exposure || 0);
    const sorted = rows.filter(c => c.iso !== "WLD").sort((a, b) => key === "prod" ? prodVal(b) - prodVal(a) || b.n_nodes - a.n_nodes : b.n_nodes - a.n_nodes || prodVal(b) - prodVal(a));
    const wld = rows.find(c => c.iso === "WLD");
    if (wld) sorted.push(wld);
    const maxN = Math.max(...sorted.map(c => c.n_nodes), 1);
    const maxP = Math.max(...sorted.map(c => c.production_exposure || 0), 1);
    const segsUsed = new Set();
    const body = sorted.map(c => {
      const segs = Country._segs(c); segs.forEach(s => segsUsed.add(s.seg));
      const wN = c.n_nodes / maxN * 100;
      const stack = `<span class="ct-bar-track"><span class="ct-stack" style="width:${wN.toFixed(2)}%">${segs.map(s => `<i style="flex:${s.n};background:var(--seg-${s.seg})"></i>`).join("")}</span></span>`;
      const nc = c.production_status === "not_covered";
      const pe = c.production_exposure || 0;
      const wP = pe / maxP * 100;
      const prod = nc
        ? `<span class="ct-bar-track"><span class="ct-nc">not measured</span></span><span class="ct-v ct-v-nc">n/c</span>`
        : `<span class="ct-bar-track">${pe > 0 ? `<span class="ct-pbar" style="width:${Math.max(0.8, wP).toFixed(2)}%"></span>` : ""}</span><span class="ct-v">${pe > 0 ? U.num(pe, 2) : "0"}</span>`;
      const dk = c.highlight ? " is-hl" : "";
      return `<div class="ct-row${dk}${c.iso === "WLD" ? " is-wld" : ""}">
        <span class="ct-name"><b>${U.esc(Country._label(c))}</b><span class="ct-iso">${U.esc(c.iso === "WLD" ? "no single HQ" : c.iso)}</span></span>
        <span class="ct-cell" data-tip-html="${U.esc(Country._stackTip(c))}">${stack}<span class="ct-v">${c.n_nodes}</span></span>
        <span class="ct-cell" data-tip-html="${U.esc(Country._prodTip(c))}">${prod}</span>
        ${Country._liveCell(c)}
      </div>`;
    }).join("");
    const legend = Object.keys(SEGMENT_LABEL).filter(s => segsUsed.has(s)).map(s => `<span><i style="background:var(--seg-${s})"></i>${U.esc(SEGMENT_LABEL[s])}</span>`).join("");
    const btn = (k, l) => `<button type="button" class="ct-seg-btn" data-barsort="${k}" aria-pressed="${key === k}">${l}</button>`;
    return `<section class="ct-block">
      <div class="ct-block-head"><div><h3>Headquarters versus production</h3><p>Where the companies are based, against how much of the chain's physical production each country actually hosts.</p></div>
        <div class="ct-sortsw" role="group" aria-label="Sort countries">Sort by ${btn("n_nodes", "companies")}${btn("prod", "production")}</div></div>
      <div class="ct-legend">${legend}</div>
      <div class="ct-chart${Country._hasLive() ? " has-live" : ""}">
        <div class="ct-row ct-hdr"><span></span><span class="ct-h" data-tip="${U.esc(CTRY_TIPS.nodes)}" tabindex="0">Companies headquartered here</span><span class="ct-h" data-tip="${U.esc(CTRY_TIPS.prod)}" tabindex="0">Production hosted here</span>${Country._hasLive() ? `<span class="ct-h ct-h-live" data-tip="${U.esc(CTRY_TIPS.today)}" tabindex="0">Today</span>` : ""}</div>
        ${body}
      </div>
    </section>`;
  },

  _hasLive() { return typeof Live !== "undefined" && Live.ready; },

  /* Today's cap-weighted move of the country's listed companies, with the live listed value in the tip. */
  _liveCell(c) {
    if (!Country._hasLive()) return "";
    const t = Country._live(c);
    if (!t) return `<span class="ct-live ct-live-none" data-tip="No listed company headquartered here is tracked live.">–</span>`;
    const tip = `<b>${U.esc(Country._label(c))}: ${U.esc(U.fmtVal(t.m, "USD_bn"))} listed value</b><span class="k-sub">${t.n} listed compan${t.n === 1 ? "y" : "ies"} headquartered here, weighted by market value. Change since each market's previous close; updated ${U.esc(Live.ago())}. Yahoo Finance quotes, some delayed 15 to 20 minutes.</span>`;
    return `<span class="ct-live" data-tip-html="${U.esc(tip)}">${Live.chg(t.c, { title: "" })}</span>`;
  },

  /* Chart 2: the composite scorecard as stacked weighted parts. */
  _scoreChart(all) {
    const scored = all.filter(c => c.scorecard && c.scorecard.composite != null).sort((a, b) => (a.scorecard.rank ?? 99) - (b.scorecard.rank ?? 99));
    if (!scored.length) return "";
    const body = scored.map(c => {
      const s = c.scorecard;
      const parts = CTRY_PARTS.map(([k, , w, col]) => { const v = s[k]; return v == null ? "" : `<i style="width:${(v * w * 10).toFixed(2)}%;background:var(${col})"></i>`; }).join("");
      const tip = `<b>${U.esc(c.name)}: ${U.num(s.composite, 2)} of 10, rank ${s.rank ?? "n/a"}</b><table class="k-tbl">${CTRY_PARTS.map(([k, l, w, col]) => `<tr><td><i class="ct-sw" style="background:var(${col})"></i>${l} <span class="k-mute">x ${U.num(w * 100, 0)}%</span></td><td class="num">${s[k] != null ? U.num(s[k], 1) : "n/a"}</td></tr>`).join("")}
        <tr class="k-sep"><td>Enterprise AI adoption</td><td class="num">${s.enterprise_ai_pct != null ? U.num(s.enterprise_ai_pct, 1) + "%" : "n/a"}</td></tr>
        <tr><td>Compute access, 0 to 5</td><td class="num">${s.compute_access_0_5 ?? "n/a"}</td></tr>
        <tr><td>Government debt / GDP</td><td class="num">${s.govt_debt_gdp != null ? U.num(s.govt_debt_gdp, 0) + "%" : "n/a"}</td></tr></table><span class="k-sub">Bar segments are each sub-score times its weight; they add up to the composite.</span>`;
      return `<div class="cs-row${c.highlight ? " is-hl" : ""}" data-tip-html="${U.esc(tip)}">
        <span class="cs-rank">${s.rank != null ? U.num(s.rank, 0) : "–"}</span>
        <span class="cs-name">${U.esc(Country._label(c))}</span>
        <span class="cs-track">${parts}</span>
        <span class="cs-v">${U.num(s.composite, 2)}</span>
      </div>`;
    }).join("");
    const legend = CTRY_PARTS.map(([, l, w, col, tip]) => `<span data-tip="${U.esc(tip)}" tabindex="0"><i style="background:var(${col})"></i>${l} <em>${U.num(w * 100, 0)}%</em></span>`).join("");
    return `<section class="ct-block">
      <div class="ct-block-head"><div><h3>AI scorecard: who is placed to gain</h3><p>A simple 0 to 10 score per country, built from how widely firms use AI, access to compute, room in the public finances and wealth. It is our estimate: official statistics combined with judgement.</p></div></div>
      <div class="ct-legend cs-legend">${legend}</div>
      <div class="cs-chart">${body}</div>
      <p class="ct-note">Hover or tap a country for its sub-scores. ${scored.length} countries are scored, including some with no company in this chain.</p>
    </section>`;
  },

  render() {
    const el = U.$("#view-country");
    const all = (APP.data.views.country || []).filter(c => c.n_nodes > 0 || (c.scorecard && c.scorecard.composite != null));
    const inChain = all.filter(c => c.n_nodes > 0);
    const allRows = Country._inChainOnly ? inChain : all;
    const layerOrder = APP.data.views.layer_order;

    const totalNodes = inChain.reduce((s, c) => s + c.n_nodes, 0);
    /* WLD is the bucket for global markets and segment nodes, not a country: keep the row, keep it
       out of the counts. */
    const realCountries = inChain.filter(c => c.iso !== "WLD");
    const wld = inChain.find(c => c.iso === "WLD");
    const top3 = [...realCountries].sort((a, b) => b.n_nodes - a.n_nodes).slice(0, 3);
    const top3Share = totalNodes ? Math.round(top3.reduce((s, c) => s + c.n_nodes, 0) / totalNodes * 100) : 0;
    const topProd = [...realCountries].sort((a, b) => (b.production_exposure || 0) - (a.production_exposure || 0))[0];
    const cov = APP.data.views.production_coverage;

    const sum = (tip, l, v, s) => `<div class="ctry-sum" data-tip="${U.esc(tip)}" tabindex="0"><div class="v">${v}</div><div class="l">${l}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;
    const summary = `<div class="ctry-summary">
      ${sum("Countries with at least one node headquartered there.", "countries in the chain", realCountries.length, "")}
      ${sum(CTRY_TIPS.nodes, "nodes placed", totalNodes, wld ? `${wld.n_nodes} of them global markets` : "")}
      ${sum("Share of all placed nodes headquartered in the three largest countries.", "held by the top three", `${top3Share}%`, top3.map(c => U.esc(c.iso)).join(" · "))}
      ${topProd ? sum(CTRY_TIPS.prod, "most production hosted", U.esc(topProd.name), `exposure ${U.num(topProd.production_exposure, 2)}`) : ""}
    </div>`;

    /* Denmark is only worth a card where the chain actually has Danish nodes. */
    const dk = inChain.find(c => c.iso === "DNK");
    let dkCard = "";
    if (dk && dk.n_nodes > 0) {
      const s = dk.scorecard || {};
      const nLayers = Object.keys(dk.nodes_by_layer).length;
      const unmapped = dk.producers - dk.producers_mapped;
      const dkProd = dk.production_status === "not_covered"
        ? `Its production exposure is not measured yet: ${unmapped === dk.producers ? (dk.producers === 1 ? "its one producing company carries" : `none of its ${dk.producers} producing companies carries`) : `${unmapped} of its ${dk.producers} producing companies carry`} ${unmapped === dk.producers && dk.producers > 1 ? "a" : "no"} production map.`
        : `Production exposure ${U.num(dk.production_exposure, 2)}.`;
      const dkGrid = APP.chain ? "" : " Energinet, the grid operator, holds 33.5 GW of connection requests on the transmission grid alone, about 60 GW with distribution, against a 7 GW peak load.";
      dkCard = `<aside class="ctry-spot"><div class="ctry-spot-t"><span class="ctry-spot-k">Spotlight</span><h3>Denmark: adoption leader, compute have-not</h3></div>
        <p>${s.enterprise_ai_pct != null ? `${U.num(s.enterprise_ai_pct, 0)}% of Danish enterprises use AI, the highest in the EU. ` : ""}${dk.n_nodes} node${dk.n_nodes === 1 ? "" : "s"} across ${nLayers} layer${nLayers === 1 ? "" : "s"}. ${dkProd}${dkGrid} Compute access ${s.compute_access_0_5 ?? "n/a"} of 5; scorecard ${s.composite != null ? U.num(s.composite, 2) : "n/a"}, rank ${s.rank != null ? U.num(s.rank, 0) : "n/a"}.</p></aside>`;
    }

    /* Full table, sortable. */
    const key = Country.sortKey; const dir = Country.sortDir;
    const val = c => key === "live_m" ? ((Country._live(c) || {}).m ?? null) : key === "live_c" ? ((Country._live(c) || {}).c ?? null) : key === "n_nodes" ? c.n_nodes : key === "name" ? c.name : key === "production_exposure" ? (c.production_status === "not_covered" ? null : c.production_exposure) : (c.scorecard || {})[key];
    const rows = [...allRows];
    rows.sort((a, b) => { const va = val(a), vb = val(b); if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1; return (va > vb ? 1 : va < vb ? -1 : 0) * dir; });
    const showL = Country._showLayers;
    const th = (k, label, title, cls) => `<th data-sort="${k}"${cls ? ` class="${cls}"` : ""}${title ? ` data-tip="${U.esc(title)}"` : ""}>${label}${key === k ? (dir < 0 ? " ▾" : " ▴") : ""}</th>`;
    const layerHeaders = showL ? layerOrder.map(l => `<th class="ctry-layer-hdr" data-tip="${U.esc((U.layerOf(l) || {}).name || l)}">${U.esc(Country._abbr(l))}</th>`).join("") : "";
    const table = `<details class="ctry-full"${Country._tableOpen ? " open" : ""}><summary>Full table: every country and score, sortable</summary>
      <div class="ctry-toolbar">
        <button class="d2-btn" type="button" id="ctry-toggle-layers" aria-pressed="${showL}">${showL ? "Hide layer columns" : "Show layer columns"}</button>
        <label class="check"><input type="checkbox" id="ctry-inchain"${Country._inChainOnly ? " checked" : ""}> Only countries with nodes in this chain</label>
        <span class="ctry-note">Click a column heading to sort.</span>
      </div>
      <div class="tbl-wrap"><table class="tbl ctry-tbl"><thead><tr>${th("name", "Country")}${th("n_nodes", "Nodes", CTRY_TIPS.nodes, "num")}${th("production_exposure", "Production", CTRY_TIPS.prod + " n/c: " + CTRY_TIPS.nc, "num")}${Country._hasLive() ? th("live_m", "Listed value", CTRY_TIPS.liveM, "num") + th("live_c", "Today", CTRY_TIPS.today, "num") : ""}${showL ? layerHeaders : ""}${th("enterprise_ai_pct", "AI adoption", CTRY_TIPS.adopt, "num")}${th("compute_access_0_5", "Compute 0-5", CTRY_TIPS.compute, "num")}${th("govt_debt_gdp", "Debt / GDP", CTRY_TIPS.debt, "num")}${th("composite", "Score", CTRY_TIPS.composite, "num")}${th("rank", "Rank", CTRY_TIPS.rank, "num")}</tr></thead><tbody>
      ${rows.map(c => {
        const s = c.scorecard || {};
        const nc = c.production_status === "not_covered";
        const pe = c.production_exposure || 0;
        const lt = Country._live(c);
        const liveCells = Country._hasLive() ? `<td class="num live-num">${lt ? U.fmtVal(lt.m, "USD_bn") : "–"}</td><td class="num">${lt ? Live.chg(lt.c) : "–"}</td>` : "";
        const layerCells = showL ? layerOrder.map(l => { const n = c.nodes_by_layer[l] || 0; return `<td class="lc-cell${n ? " has" : ""}">${n || ""}</td>`; }).join("") : "";
        return `<tr class="${c.highlight ? "is-hl" : ""}${c.n_nodes ? "" : " off-chain"}"><td>${U.esc(Country._label(c))} <span class="ct-iso">${U.esc(c.iso)}</span></td><td class="num">${c.n_nodes || "–"}</td><td class="num"${nc ? ` data-tip="${U.esc(CTRY_TIPS.nc)}"` : ""}>${pe > 0 ? U.num(pe, 2) : nc ? "<span class='ct-v-nc'>n/c</span>" : "0"}</td>${liveCells}${layerCells}<td class="num">${s.enterprise_ai_pct != null ? U.num(s.enterprise_ai_pct, 1) + "%" : "–"}</td><td class="num">${s.compute_access_0_5 ?? "–"}</td><td class="num">${s.govt_debt_gdp != null ? U.num(s.govt_debt_gdp, 0) + "%" : "–"}</td><td class="num">${s.composite != null ? U.num(s.composite, 2) : "–"}</td><td class="num">${s.rank ?? "–"}</td></tr>`;
      }).join("")}
      </tbody></table></div>
      <p class="ct-note"><b>n/c</b>: not covered. Producing companies headquartered there carry no production map yet, so the zero is a gap in coverage, not a finding.${cov ? ` So far ${cov.producers_mapped} of the ${cov.producers} producing companies in this chain carry a production map.` : ""} <b>Global markets</b> is not a country: it holds market and segment nodes with no single headquarters. A dash means no data.${Country._hasLive() ? " Listed value and Today come from live quotes, updated <span class='live-ago'>" + Live.ago() + "</span>." : ""}</p>
    </details>`;

    el.innerHTML = `<div class="container ct-wrap">
      <header class="vh"><h2>Where the chain sits</h2><p>The United States is home to most of the companies; much of the physical production happens elsewhere. Each country by headquarters, by production, and on a simple AI scorecard.</p></header>
      ${summary}
      ${Country._hqProdChart(inChain)}
      ${dkCard}
      ${Country._scoreChart(all)}
      ${table}
    </div>`;

    U.$$("th[data-sort]", el).forEach(h => U.on(h, "click", () => {
      const k = h.getAttribute("data-sort");
      if (!k) return;
      if (Country.sortKey === k) Country.sortDir *= -1; else { Country.sortKey = k; Country.sortDir = k === "name" ? 1 : -1; }
      Country._tableOpen = true; Country.render();
    }));
    U.$$("[data-barsort]", el).forEach(b => U.on(b, "click", () => { Country._barSort = b.getAttribute("data-barsort"); Country.render(); }));
    const det = U.$(".ctry-full", el);
    if (det) det.addEventListener("toggle", () => { Country._tableOpen = det.open; });
    const togBtn = U.$("#ctry-toggle-layers", el);
    if (togBtn) togBtn.addEventListener("click", () => { Country._showLayers = !Country._showLayers; Country._tableOpen = true; Country.render(); });
    const inChainBox = U.$("#ctry-inchain", el);
    if (inChainBox) inChainBox.addEventListener("change", () => { Country._inChainOnly = inChainBox.checked; Country._tableOpen = true; Country.render(); });
    KTip.bind(el);
    KTip.hide();
  },
};

/* Re-render the active view when live quotes arrive; the hover cards read live data directly. */
if (typeof Live !== "undefined") Live.on(() => {
  const v = APP.state && APP.state.view;
  if (v === "country") { Country.render(); Live.flash(U.$("#view-country")); }
  else if (v === "demand") Demand.render();
});
/* Findings tab: renders data/findings/*.md (bundled into findings.json) with a small Markdown converter. */

/* Short labels for the report pills. Anything not listed is humanised from the file stem. */
const FINDINGS_LABEL = {
  "00_method": "Method",
  "05_start_here": "Start here",
  "10_map": "Map",
  "20_bottlenecks": "Bottlenecks",
  "30_flows": "Flows",
  "40_countries": "Countries",
  "50_cost_of_capital": "Cost of capital",
  "60_demand": "Demand 2×2",
};

const Findings = {
  data: null, current: null,

  /* Links inside a report point at nodes, layers, views or other reports. A report can outlive a
     node, so every target is resolved against this build: a target that no longer exists is shown
     as plain text instead of a link that opens nothing. */
  resolve(href) {
    const h = String(href || "").replace(/^#/, "");
    if (!h) return { kind: "none" };
    if (!h.includes("=")) return { kind: "anchor", id: h };
    const p = {};
    for (const part of h.split("&")) { const [k, v] = part.split("=").map(decodeURIComponent); p[k] = v; }
    if (p.n) return { kind: "node", id: p.n, ok: !!U.nodeOf(p.n) };
    if (p.l) return { kind: "layer", id: p.l, ok: !!U.layerOf(p.l) };
    if (p.f) return { kind: "report", id: p.f, ok: !!(Findings.data && Findings.data[p.f]) };
    if (p.v) { const t = U.$("#tab-" + p.v); return { kind: "view", id: p.v, ok: !!(t && !t.hidden) }; }
    if (p.ch !== undefined) return { kind: "chain", id: p.ch || "", ok: (p.ch || "") !== (APP.chain || "") };
    return { kind: "none" };
  },

  md(src) {
    const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const seen = {};
    const slugify = t => {
      let s = t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
      if (seen[s] == null) { seen[s] = 0; return s; }
      seen[s] += 1; return `${s}-${seen[s]}`;
    };
    const link = (label, href) => {
      const r = Findings.resolve(href);
      if (r.kind === "anchor" || r.kind === "none") return `<a href="${href}">${label}</a>`;
      if (!r.ok) return `<span class="findings-dead" title="No longer in the graph">${label}</span>`;
      return `<a class="findings-link" href="${href}">${label}</a>`;
    };
    const inline = s => esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\[([^\]]+)\]\((#[^)\s]+)\)/g, (_m, t, h) => link(t, h))
      .replace(/\[((?:[A-Z][A-Za-z0-9_]+|grade [A-D]|[A-D])(?:[,;/][^\]]*)?)\](?!\()/g, (_m, t) => Findings.cite(t));
    const lines = src.split(/\r?\n/); const out = []; let list = null; let para = []; let table = null;
    const flushP = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
    const flushL = () => { if (list) { out.push(`</${list}>`); list = null; } };
    const flushT = () => { if (table) { out.push(`<div class="md-tbl"><table><thead><tr>${table.head.map((c, i) => `<th${table.align[i] || ""}>${inline(c)}</th>`).join("")}</tr></thead><tbody>${table.rows.map(r => `<tr>${r.map((c, i) => `<td${table.align[i] || ""}>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`); table = null; } };
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (/^\|/.test(line)) {
        flushP(); flushL();
        const cells = line.replace(/^\||\|$/g, "").split("|").map(c => c.trim());
        if (cells.every(c => /^:?-{2,}:?$/.test(c))) { if (table) table.align = cells.map(c => /-:$/.test(c) ? ' class="num"' : ""); continue; }
        if (!table) table = { head: cells, rows: [], align: [] }; else table.rows.push(cells);
        continue;
      } else flushT();
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushP(); flushL(); out.push("<hr>"); continue; }
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) { flushP(); flushL(); const plain = Findings.plain(h[2]); out.push(`<h${h[1].length} id="${slugify(plain)}">${inline(h[2])}</h${h[1].length}>`); continue; }
      const li = line.match(/^\s*[-*]\s+(.*)$/); if (li) { flushP(); if (list !== "ul") { flushL(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(li[1])}</li>`); continue; }
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/); if (ol) { flushP(); if (list !== "ol") { flushL(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inline(ol[1])}</li>`); continue; }
      if (!line.trim()) { flushP(); flushL(); continue; }
      para.push(line);
    }
    flushP(); flushL(); flushT();
    /* the first italic paragraph under the title is the standfirst */
    return out.join("\n").replace(/<p><em>([\s\S]*?)<\/em><\/p>/, '<p class="md-standfirst">$1</p>');
  },

  /* A source citation such as [C10, grade A] or [THESIS_2026_09_12, D]: grades become the usual
     grade chips and source ids get their title as a tooltip, linking out where the source is public. */
  cite(inner) {
    const srcs = (APP.data && APP.data.sources) || {};
    let html = inner.replace(/(grade\s+)?\b([A-D])\b(?=\s*(?:[;,/]|$))/g, (_m, _g, c) => U.gradeChip(c));
    html = html.replace(/\b([A-Z][A-Z0-9_]+)\b/g, id => {
      const s = srcs[id];
      if (!s) return id;
      if (s.type === "internal") return `<span class="cite-src" title="Our own analysis${s.date ? ", " + U.esc(s.date) : ""}">own analysis</span>`;
      const tip = U.esc([s.title, s.publisher, s.date].filter(Boolean).join(" · "));
      return /^https?:/.test(s.url || "") ? `<a class="cite-src" href="${U.esc(s.url)}" target="_blank" rel="noopener" title="${tip}">${id}</a>` : `<span class="cite-src" title="${tip}">${id}</span>`;
    });
    const tip = inner.replace(/\b([A-Z][A-Z0-9_]+)\b/g, id => { const s = srcs[id]; return !s ? id : s.type === "internal" ? "our own analysis" : [s.title, s.publisher, s.date].filter(Boolean).join(", "); });
    return `<span class="cite" title="${U.esc("Source: " + tip)}">${html}</span>`;
  },

  plain(t) {
    return t.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
  },

  /* Headings for the table of contents. The H1 is the report title, so it is not listed. */
  extractToc(src) {
    const headings = []; const seen = {};
    const slugify = t => {
      let s = t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
      if (seen[s] == null) { seen[s] = 0; return s; }
      seen[s] += 1; return `${s}-${seen[s]}`;
    };
    for (const line of src.split(/\r?\n/)) {
      const m = line.match(/^(#{1,4})\s+(.*)$/);
      if (!m) continue;
      const text = Findings.plain(m[2]);
      const slug = slugify(text);
      if (m[1].length === 1) continue;
      headings.push({ level: m[1].length, text, slug });
    }
    return headings;
  },

  title(src, key) {
    const m = src.match(/^#\s+(.*)$/m);
    return m ? Findings.plain(m[1]) : Findings.displayName(key);
  },

  /* The first italic line under the title is the report's standfirst. */
  standfirst(src) {
    const m = src.match(/^\*([^*\n][^\n]*)\*\s*$/m);
    return m ? Findings.plain(m[1]) : "";
  },

  asOf(src) {
    const m = src.match(/(?:as of|updated|build of)[:\s]*([0-9]{1,2}[\s-][A-Za-z]+[\s-][0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2}|[A-Za-z]+ [0-9]{4})/i);
    if (m) return m[1];
    return APP.data && APP.data.meta ? APP.data.meta.today : null;
  },

  displayName(key) {
    if (FINDINGS_LABEL[key]) return FINDINGS_LABEL[key];
    return key.replace(/^\d+[_-]/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  },

  /* Start here first, the method last, the topical reports in file order between them. */
  order() {
    const keys = Object.keys(Findings.data || {}).sort();
    const pull = (k, front) => { const i = keys.indexOf(k); if (i < 0) return; keys.splice(i, 1); if (front) keys.unshift(k); else keys.push(k); };
    pull("00_method", false); pull("05_start_here", true);
    return keys;
  },

  async render() {
    const el = U.$("#view-findings");
    if (!Findings.data) { try { const r = await fetch(Data.url("findings.json"), { cache: "no-cache" }); Findings.data = r.ok ? await r.json() : {}; } catch (e) { Findings.data = {}; } }
    const keys = Findings.order();
    if (!keys.length) { el.innerHTML = `<div class="container"><p class="note">No findings reports yet.</p></div>`; return; }
    Findings.current = Findings.current && Findings.data[Findings.current] ? Findings.current : keys[0];
    const cur = Findings.current;
    const curSrc = Findings.data[cur];
    const toc = Findings.extractToc(curSrc);
    const asOf = Findings.asOf(curSrc);
    const idx = keys.indexOf(cur);
    const prev = idx > 0 ? keys[idx - 1] : null;
    const next = idx < keys.length - 1 ? keys[idx + 1] : null;

    const wide = typeof window !== "undefined" && window.innerWidth >= 1080;
    const tocHtml = toc.length > 1 ? `<details class="findings-toc"${wide ? " open" : ""}><summary>In this report</summary><ol>${toc.filter(h => h.level <= 3).map(h => `<li class="findings-toc-${h.level}"><a href="#${h.slug}" data-slug="${h.slug}">${U.esc(h.text)}</a></li>`).join("")}</ol></details>` : "";

    const titleOf = k => Findings.title(Findings.data[k], k);
    const list = `<nav class="findings-nav" aria-label="Reports"><ol>${keys.map((k, i) => `<li><button aria-current="${k === cur ? "true" : "false"}" data-key="${k}"><span class="fn-i">${i + 1}</span><span class="fn-t">${U.esc(Findings.displayName(k))}</span></button></li>`).join("")}</ol></nav>`;
    const pager = (prev || next) ? `<div class="findings-pager">${prev ? `<button data-key="${prev}"><span class="fp-k">← Previous</span><span class="fp-t">${U.esc(titleOf(prev))}</span></button>` : "<span></span>"}${next ? `<button class="next" data-key="${next}"><span class="fp-k">Next →</span><span class="fp-t">${U.esc(titleOf(next))}</span></button>` : "<span></span>"}</div>` : "";

    el.innerHTML = `<div class="container findings-wrap">
      <header class="findings-head"><h2>Findings</h2><p>${keys.length} short report${keys.length === 1 ? "" : "s"} written from the data on this site. Every figure carries its source and a confidence grade; underlined links open the company, layer or view they refer to.</p></header>
      <div class="findings-body">
        <aside class="findings-rail">${list}${tocHtml}</aside>
        <article class="md findings-md">
          <div class="findings-asof">Report ${idx + 1} of ${keys.length}${asOf ? ` · written from the build of 19 September 2026; the other tabs show today's data` : ""}</div>
          ${Findings.md(curSrc)}${pager}
        </article>
      </div></div>`;
    Findings.bind(el);
  },

  bind(el) {
    U.$$(".findings-nav button, .findings-pager button", el).forEach(b => U.on(b, "click", () => {
      Findings.current = b.getAttribute("data-key");
      Findings.render().then(() => { const v = U.$("#view-findings"); if (v) v.scrollTop = 0; });
    }));
    U.$$(".md a.findings-link", el).forEach(a => U.on(a, "click", e => {
      e.preventDefault();
      const r = Findings.resolve(a.getAttribute("href"));
      if (!r.ok) return;
      if (r.kind === "node") { State.set({ node: r.id, layer: null }); if (typeof MapView !== "undefined" && MapView.focusNode) MapView.focusNode(r.id); }
      else if (r.kind === "layer") State.set({ layer: r.id, node: null });
      else if (r.kind === "report") { Findings.current = r.id; Findings.render().then(() => { const v = U.$("#view-findings"); if (v) v.scrollTop = 0; }); }
      else if (r.kind === "view") State.set({ view: r.id });
      /* a chain link reloads the page on the other chain, exactly as the header buttons do */
      else if (r.kind === "chain") { location.hash = r.id ? `#ch=${encodeURIComponent(r.id)}&v=findings` : "#v=findings"; location.reload(); }
    }));
    /* mark the contents entry for the section being read */
    const view = U.$("#view-findings");
    if (view && !Findings._scrollBound) {
      Findings._scrollBound = true;
      view.addEventListener("scroll", () => {
        const links = U.$$(".findings-toc a[data-slug]", view); if (!links.length) return;
        let cur = links[0];
        for (const a of links) { const h = document.getElementById(a.getAttribute("data-slug")); if (h && h.getBoundingClientRect().top < 140) cur = a; }
        links.forEach(a => a.classList.toggle("on", a === cur));
      }, { passive: true });
    }
    /* smooth scroll to heading anchors within the report */
    U.$$(".findings-toc a, .md a[href^='#']", el).forEach(a => {
      if (a.classList.contains("findings-link")) return;
      U.on(a, "click", e => {
        e.preventDefault();
        const id = a.getAttribute("href").replace(/^#/, "");
        const target = document.getElementById(id);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  },
};
const Boot = {
  async start() {
    try { await Data.load(); } catch (e) { const f = U.$("#fallback"); f.hidden = false; f.textContent = "Could not load graph.json: " + e.message; return; }
    Theme.read(); Theme.watch(() => MapView.request());
    APP.state = State.read();
    const m = APP.data.meta; U.$("#build-meta").textContent = `${m.node_count} nodes · ${m.edge_count} edges · built ${m.today}`;
    U.$("#build-meta").title = `${m.warnings} build warnings (stale or estimate-only figures) · schema ${m.schema_version}`;
    if (m.title) { U.$(".brand-name").textContent = m.title; document.title = m.title; }
    if (m.public) U.$("#build-meta").innerHTML = `by <a href="/">GJI</a> · data ${U.esc(m.today)}`;
    for (const [v, label] of Object.entries(m.tab_labels || {})) { const t = U.$(`#tab-${v}`); if (t) t.textContent = label; }
    const desc = document.querySelector('meta[name="description"]');
    if (desc && m.title) desc.setAttribute("content", `${m.title}: ${m.node_count} companies and markets across ${m.layer_count} layers, with bottleneck scores, flows and country exposure.`);
    U.$$(".chains button").forEach(b => { b.setAttribute("aria-pressed", String((b.dataset.chain || "") === (APP.chain || ""))); U.on(b, "click", () => { const ch = b.dataset.chain || ""; if (ch === (APP.chain || "")) return; location.hash = ch ? `#ch=${ch}` : "#"; location.reload(); }); });
    Boot.fillFilters(); Boot.bind();
    /* chain-aware copy: the how-to paragraph names the actual bottom and top layers, and the Nordic filter only shows when the chain has Nordic nodes */
    const lays = APP.data.layers.filter(l => l.kind !== "capital");
    if (lays.length >= 2) {
      const bottom = lays[0].name.toLowerCase(), top = lays[lays.length - 1].name.toLowerCase();
      const howto = U.$("#howto p");
      if (howto) howto.textContent = `Each horizontal band is one layer of the chain, ${bottom} at the bottom and ${top} at the top. Circle size follows market cap (or market share for products and resources); colour is the chain segment. The left column summarises the layer: how full its capacity is, how fast capacity and demand are growing, valuation, risks. Click a band's title for the layer panel, a circle for the company panel. Dashed circles have estimates only; an amber dot marks a stale figure. Lines are supply, lease, finance and token flows; select a node to isolate its chain.`;
    }
    const hasNordic = APP.data.nodes.some(n => ["DNK", "SWE", "NOR", "FIN", "ISL"].includes(n.hq));
    const dkLabel = U.$("#f-dk") && U.$("#f-dk").closest("label"); if (dkLabel) dkLabel.hidden = !hasNordic;
    MapView.init();
    /* the Flows view also renders a structural Sankey from graph.edges, so it is useful whenever the chain has edges */
    if ((APP.data.flows && Object.keys(APP.data.flows).length) || (APP.data.edges || []).length) U.$("#tab-flows").hidden = false;
    if (APP.data.meta.has_rates) U.$("#tab-rates").hidden = false;
    if ((APP.data.meta.findings || []).length) U.$("#tab-findings").hidden = false;
    Boot.render();
    if (APP.state.node) MapView.focusNode(APP.state.node);
    if (typeof Live !== "undefined") Live.start();
    window.addEventListener("hashchange", () => { APP.state = State.read(); Boot.render(); });
  },
  fillFilters() {
    const cs = U.$("#f-country"); const names = Object.fromEntries((APP.data.views.country || []).map(c => [c.iso, c.name]));
    for (const iso of APP.idx.countries) { const o = document.createElement("option"); o.value = iso; o.textContent = names[iso] || iso; cs.appendChild(o); }
    const ks = U.$("#f-kind"); for (const [k, v] of Object.entries(SEGMENT_LABEL)) { const o = document.createElement("option"); o.value = k; o.textContent = v; ks.appendChild(o); }
  },
  bind() {
    U.$$(".tab").forEach(t => U.on(t, "click", () => State.set({ view: t.getAttribute("data-view") })));
    const sync = () => State.set({ country: U.$("#f-country").value, own: U.$("#f-own").value, kind: U.$("#f-kind").value, bn: U.$("#f-bn").value, dk: U.$("#f-dk").checked });
    ["#f-country", "#f-own", "#f-kind", "#f-bn", "#f-dk"].forEach(s => U.on(U.$(s), "change", sync));
    U.on(U.$("#f-reset"), "click", () => State.set({ country: "", own: "", kind: "", bn: "", dk: false, q: "" }));
    const inp = U.$("#search-input"); const res = U.$("#search-results");
    U.on(inp, "input", U.debounce(() => {
      const q = inp.value; const hits = Data.find(q);
      if (!q.trim()) { res.hidden = true; State.set({ q: "" }); return; }
      res.hidden = false; res.innerHTML = hits.map(n => `<button data-id="${n.id}"><span>${U.esc(n.name)}${n.tk ? ` <span class="sr-layer">${U.esc(n.tk)}</span>` : ""}</span><span class="sr-layer">${U.esc(U.layerOf(n.layer).name)}</span></button>`).join("") || `<button disabled>No match</button>`;
      U.$$("button[data-id]", res).forEach(b => U.on(b, "click", () => { res.hidden = true; inp.value = ""; State.set({ node: b.getAttribute("data-id"), layer: null, q: "" }); MapView.focusNode(b.getAttribute("data-id")); }));
      State.set({ q });
    }, 120));
    U.on(document, "click", e => { if (!e.target.closest(".search")) res.hidden = true; });
    U.on(document, "keydown", e => { if (e.key === "Escape") { res.hidden = true; const panel = U.$("#panel"); if (document.activeElement !== U.$("#map-canvas") && panel && !panel.hidden) Panel.close(); } });
  },
  render() {
    const s = APP.state;
    U.$$(".tab").forEach(t => t.setAttribute("aria-selected", t.getAttribute("data-view") === s.view ? "true" : "false"));
    for (const v of ["overview", "map", "bottlenecks", "demand", "country", "flows", "rates", "findings"]) U.$(`#view-${v}`).hidden = v !== s.view;
    /* the filter bar drives the map only: Data.passes is read nowhere else */
    U.$("#filters").style.display = s.view === "map" ? "" : "none";
    U.$("#f-country").value = s.country; U.$("#f-own").value = s.own; U.$("#f-kind").value = s.kind; U.$("#f-bn").value = s.bn; U.$("#f-dk").checked = !!s.dk;
    const shown = APP.data.nodes.filter(Data.passes).length; U.$("#filter-count").textContent = `${shown} / ${APP.data.nodes.length} nodes`;
    if (s.view === "overview") Overview.render();
    else if (s.view === "map") { MapView.resize(); MapView.request(); }
    else if (s.view === "bottlenecks") Dashboard.render();
    else if (s.view === "demand") Demand.render();
    else if (s.view === "country") Country.render();
    else if (s.view === "flows") Sankey.render();
    else if (s.view === "rates") Rates.render();
    else if (s.view === "findings") { if (!(APP.data.meta.findings || []).length) { State.set({ view: "map" }); return; } Findings.render(); }
    Panel.render();
  },
};
document.addEventListener("DOMContentLoaded", Boot.start);
