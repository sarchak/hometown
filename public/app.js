/* Hometown front end: talks to /api/agent over server-sent events and paints
   the run sheet, the map and the tour book from the agent's tool events. */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (n) => Math.round((n ?? 0) * 100);

const state = { messages: [], act: null, markets: {}, plans: {}, route: null, busy: false };

// ---------- map ----------
const map = L.map("map", { zoomControl: true, attributionControl: true }).setView([38, -96], 4);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
const layers = { markets: L.layerGroup().addTo(map), cells: L.layerGroup().addTo(map), venues: L.layerGroup().addTo(map), route: L.layerGroup().addTo(map) };
const marketMarkers = {};

function paintMarket(m) {
  if (!m.centroid) return;
  const r = 6 + (m.score / 100) * 22;
  const old = marketMarkers[m.city];
  if (old) layers.markets.removeLayer(old);
  const mk = L.circleMarker([m.centroid.lat, m.centroid.lon], { radius: r, color: "#14213D", weight: 1.5, fillColor: "#14213D", fillOpacity: 0.15 + (m.score / 100) * 0.55 })
    .bindTooltip(`<b>${esc(m.city)}</b> ${m.score}`, { direction: "top", offset: [0, -r] });
  mk.addTo(layers.markets);
  marketMarkers[m.city] = mk;
  state.markets[m.city] = m;
}

function paintCity(plan) {
  for (const c of plan.cells ?? []) {
    L.circle([c.lat, c.lon], { radius: 500 + c.affinity * 900, stroke: false, fillColor: "#D7263D", fillOpacity: 0.05 + c.affinity * 0.3 }).addTo(layers.cells);
  }
  plan.venues.forEach((v, i) => {
    if (!v.location) return;
    L.circleMarker([v.location.lat, v.location.lon], { radius: i === 0 ? 8 : 5, color: "#14213D", weight: 2, fillColor: i === 0 ? "#F4D35E" : "#fff", fillOpacity: 1 })
      .bindPopup(`<b>${esc(v.name)}</b><br>${esc(v.address ?? "")}<br>Fan affinity ${pct(v.affinity)}${v.rating ? ` &nbsp; rated ${v.rating}` : ""}`)
      .addTo(layers.venues);
  });
}

function paintRoute(route) {
  layers.route.clearLayers();
  const pts = [];
  route.stops.forEach((s, i) => {
    const m = state.markets[s.city] || Object.values(state.markets).find((x) => x.city.toLowerCase() === s.city.toLowerCase());
    const plan = state.plans[s.city];
    const venue = plan?.venues.find((v) => v.name === s.venue);
    const p = venue?.location ?? plan?.hotspot ?? m?.centroid;
    if (!p) return;
    pts.push([p.lat, p.lon]);
    L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "", html: `<div class="stop-marker">${i + 1}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }), zIndexOffset: 1000 })
      .bindPopup(`<b>${esc(s.city)}</b><br>${esc(s.venue)}${s.opener ? `<br>with ${esc(s.opener)}` : ""}`)
      .addTo(layers.route);
  });
  if (pts.length > 1) L.polyline(pts, { color: "#D7263D", weight: 3, dashArray: "8 8" }).addTo(layers.route);
  if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.35), { maxZoom: 7 });
}

// ---------- run sheet ----------
const LABELS = {
  resolve_act: (a) => `Finding "${a.query}" in Qloo`,
  rank_markets: (a) => `Ranking ${a.cities?.length ? a.cities.length + " cities" : (a.region ?? "US") + " markets"} with Qloo heatmaps`,
  plan_city: (a) => `Building the night in ${a.city}`,
  crowd_profile: () => "Reading the crowd: age, gender, taste tags",
  find_sponsors: (a) => `Finding sponsor brands${a.city ? " for " + a.city : ""}`,
  momentum: () => "Checking six months of Qloo trending data",
  find_tag: (a) => `Looking up the tag "${a.query}"`,
  finalize_tour: () => "Locking the route",
};
const SUMMARY = {
  resolve_act: (r) => r.candidates?.length ? `Top match: ${r.candidates[0].name} (${(r.candidates[0].type ?? "").split(":").pop()})` : "No match",
  rank_markets: (r) => `${r.markets.length} markets scored. Top: ${r.markets.slice(0, 3).map((m) => `${m.city} ${m.score}`).join(", ")}`,
  plan_city: (r) => `${r.venues.length} rooms, ${r.spots.length} pre-show spots, ${r.openers.length} local openers`,
  crowd_profile: (r) => `${r.tags.length} taste tags`,
  find_sponsors: (r) => `${r.brands.length} brands: ${r.brands.slice(0, 3).map((b) => b.name).join(", ")}`,
  momentum: (r) => r.change === undefined ? "No trend data" : `${r.change >= 0 ? "Up" : "Down"} ${Math.abs(r.change).toFixed(1)} percentile points`,
  find_tag: (r) => r.tags.map((t) => t.name).slice(0, 4).join(", "),
  finalize_tour: (r) => `${r.stops.length} stops`,
};

function addStep(ev) {
  const li = document.createElement("li");
  li.className = "running"; li.dataset.id = ev.id;
  li.innerHTML = `<div class="title">${esc((LABELS[ev.name] ?? (() => ev.name))(ev.args))}</div><div class="meta">running</div>`;
  $("#steps").appendChild(li);
  li.scrollIntoView({ block: "nearest" });
}
function finishStep(ev) {
  const li = document.querySelector(`#steps li[data-id="${ev.id}"]`);
  if (!li) return;
  li.className = ev.error ? "failed" : "done";
  const summary = ev.error ? `Failed: ${ev.error}` : (SUMMARY[ev.name] ?? (() => "done"))(ev.result);
  li.querySelector(".meta").innerHTML = `${esc(summary)} <span>(${(ev.ms / 1000).toFixed(1)}s)</span>`;
  const det = document.createElement("details");
  det.innerHTML = `<summary>Qloo inputs</summary><code>${esc(JSON.stringify(ev.args, null, 1))}</code>`;
  li.appendChild(det);
}

// ---------- tour book ----------
function showAct(r) {
  const c = r.candidates?.[0]; if (!c) return;
  state.act = c;
  $("#act-card").hidden = false;
  $("#act-card").innerHTML = `${c.image ? `<img src="${esc(c.image)}" alt="">` : ""}<div><h2>${esc(c.name)}</h2><p>${esc((c.type ?? "").split(":").pop().replace("_", " "))}${c.disambiguation ? ", " + esc(c.disambiguation) : ""}. Qloo popularity ${pct(c.popularity)}th percentile.</p></div>`;
  $("#book-title").textContent = `${c.name} tour book`;
}

function showMarkets(r) {
  const el = $("#markets"); el.hidden = false;
  el.innerHTML = r.markets.slice(0, 15).map((m) => `<div class="m" data-city="${esc(m.city)}"><span>${esc(m.city)}</span><b>${m.score}</b><div class="bar"><i style="width:${m.score}%"></i></div></div>`).join("");
  el.querySelectorAll(".m").forEach((d) => d.addEventListener("click", () => { const m = state.markets[d.dataset.city]; if (m?.centroid) map.flyTo([m.centroid.lat, m.centroid.lon], 11); }));
  $("#book-sub").textContent = `${r.markets.length} markets ranked by how strongly this crowd over-indexes there. Score is the mean affinity of the hottest Qloo heatmap cells, weighted by local popularity.`;
}

const row = (x, pick) => `<li class="${pick ? "pick" : ""}"><span class="name">${esc(x.name)}${x.address || x.tags?.length ? `<small>${esc(x.address ?? x.tags.slice(0, 2).join(", "))}</small>` : ""}</span><span class="aff">${pct(x.affinity)}</span></li>`;

function stopCard(plan, i, stop) {
  const venue = (stop && plan.venues.find((v) => v.name === stop.venue)) || plan.venues[0];
  return `<section class="stop" data-city="${esc(plan.city)}">
    <div class="n">${i + 1}<small>score ${plan.score}</small></div>
    <div>
      <h3>${esc(plan.city)}</h3>
      <p class="why">${esc(stop?.why ?? "Hotspot and rooms from Qloo. The agent is still choosing the route.")}</p>
      ${venue ? `<div class="venue-row">${venue.image ? `<img src="${esc(venue.image)}" alt="">` : ""}<div><b>${esc(venue.name)}</b><span>${esc(venue.address ?? "")}${venue.rating ? `, rated ${venue.rating}` : ""}${venue.price_level ? ", " + "$".repeat(venue.price_level) : ""}. Fan affinity ${pct(venue.affinity)}.</span></div></div>` : ""}
      <div class="cols">
        <div><h4>Rooms fans already like</h4><ul>${plan.venues.slice(0, 5).map((v) => row(v, v.name === venue?.name)).join("") || "<li>No tagged venues near the hotspot. Try another room type.</li>"}</ul></div>
        <div><h4>Local acts who share the crowd</h4><ul>${plan.openers.slice(0, 5).map((o) => row(o, stop && o.name === stop.opener)).join("") || "<li>None returned.</li>"}</ul></div>
        <div><h4>Pre-show spots</h4><ul>${plan.spots.slice(0, 5).map((s) => row(s)).join("") || "<li>None returned.</li>"}</ul></div>
      </div>
    </div>
  </section>`;
}

function renderStops() {
  const order = state.route ? state.route.stops.map((s) => s.city) : Object.keys(state.plans);
  const html = order.map((city, i) => {
    const plan = state.plans[city] ?? Object.values(state.plans).find((p) => p.city.toLowerCase() === city.toLowerCase());
    const stop = state.route?.stops[i];
    return plan ? stopCard(plan, i, stop) : `<section class="stop pending"><div class="n">${i + 1}</div><div><h3>${esc(city)}</h3><p class="why">${esc(stop?.why ?? "")}</p></div></section>`;
  }).join("");
  $("#stops-list").innerHTML = html;
  document.querySelectorAll("#markets .m").forEach((d) => d.classList.toggle("chosen", order.some((c) => c.toLowerCase() === d.dataset.city.toLowerCase())));
  $("#print").hidden = !state.route;
}

const AGE_LABELS = { "24_and_younger": "under 25", "25_to_29": "25 to 29", "30_to_34": "30 to 34", "35_to_44": "35 to 44", "45_to_54": "45 to 54", "55_and_older": "55 and up" };
function showCrowd(r) {
  const el = $("#crowd"); el.hidden = false;
  const ages = Object.entries(AGE_LABELS).map(([k, label]) => { const v = r.age?.[k] ?? 0; const w = Math.min(50, Math.abs(v) * 50); return `<span>${label}</span><div class="track"><i class="${v < 0 ? "neg" : ""}" style="left:${v < 0 ? 50 - w : 50}%;width:${w}%"></i></div><span>${v >= 0 ? "+" : ""}${v.toFixed(2)}</span>`; }).join("");
  const g = r.gender ?? {};
  el.innerHTML = `<div class="col"><h3>Who shows up</h3><p>Qloo affinity by age, relative to average</p><div class="ages">${ages}</div><p style="margin-top:8px">Gender skew: ${g.male !== undefined ? `men ${g.male >= 0 ? "+" : ""}${g.male.toFixed(2)}, women ${g.female >= 0 ? "+" : ""}${g.female.toFixed(2)}` : "not returned"}</p></div>
    <div class="col"><h3>What they are into</h3><p>Taste tags Qloo attaches to this crowd</p><div class="chips" id="tagchips">${r.tags.map((t) => `<span class="chip">${esc(t.name)}<small>${pct(t.affinity)}</small></span>`).join("")}</div>
    <div id="sponsors"></div><div id="trend"></div></div>`;
}
function showSponsors(r) {
  const el = $("#sponsors"); if (!el) return;
  el.innerHTML = `<h3 style="margin-top:14px">Brands this crowd over-indexes on</h3><p>Sponsorship and local partnership targets${r.city ? `, localised to ${esc(r.city)}` : ""}</p><div class="chips">${r.brands.map((b) => `<span class="chip brand">${esc(b.name)}<small>${pct(b.affinity)}</small></span>`).join("")}</div>`;
}
function showMomentum(r) {
  const el = $("#trend"); if (!el || !r.points?.length) return;
  const xs = r.points.map((p) => p.percentile ?? 0);
  const min = Math.min(...xs), max = Math.max(...xs), span = max - min || 1;
  const W = 400, H = 60;
  const path = xs.map((v, i) => `${i ? "L" : "M"}${(i / (xs.length - 1)) * W},${H - 4 - ((v - min) / span) * (H - 8)}`).join(" ");
  el.innerHTML = `<h3 style="margin-top:14px">Momentum</h3><p>Qloo trending percentile, weekly, last six months: ${r.change >= 0 ? "up" : "down"} ${Math.abs(r.change ?? 0).toFixed(1)} points (${r.points[0].date} to ${r.points.at(-1).date})</p><svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path class="fill" d="${path} L${W},${H} L0,${H} Z"></path><path d="${path}"></path></svg>`;
}

// ---------- agent transport ----------
async function send(text) {
  if (state.busy) return;
  state.busy = true;
  $("#go").disabled = true; $("#followup button").disabled = true;
  state.messages.push({ role: "user", content: text });
  if (state.messages.length > 1) { const u = document.createElement("article"); u.className = "memo user"; u.textContent = text; $("#steps").before(u); }
  $("#memo").hidden = true;

  const res = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: state.messages }) });
  if (!res.ok || !res.body) { showError(`The agent could not start (${res.status}).`); return finish(); }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line) handle(JSON.parse(line.slice(6)));
    }
  }
  finish();
}
function finish() { state.busy = false; $("#go").disabled = false; $("#followup button").disabled = false; $("#followup").hidden = false; $("#ask").focus(); }
function showError(msg) { const m = $("#memo"); m.hidden = false; m.innerHTML = `<p><b>Something went wrong.</b> ${esc(msg)}</p>`; }

function handle(ev) {
  switch (ev.type) {
    case "tool_call": addStep(ev); break;
    case "market": paintMarket(ev.market); break;
    case "tool_result":
      finishStep(ev);
      if (ev.error) break;
      if (ev.name === "resolve_act") showAct(ev.result);
      if (ev.name === "rank_markets") { ev.result.markets.forEach(paintMarket); showMarkets(ev.result); const pts = ev.result.markets.filter((m) => m.centroid && m.score > 0).map((m) => [m.centroid.lat, m.centroid.lon]); if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.2)); }
      if (ev.name === "plan_city") { state.plans[ev.result.city] = ev.result; paintCity(ev.result); renderStops(); }
      if (ev.name === "crowd_profile") showCrowd(ev.result);
      if (ev.name === "find_sponsors") showSponsors(ev.result);
      if (ev.name === "momentum") showMomentum(ev.result);
      if (ev.name === "finalize_tour") { state.route = ev.result; $("#book-title").textContent = ev.result.title; renderStops(); paintRoute(ev.result); }
      break;
    case "message": { const m = $("#memo"); m.hidden = false; m.innerHTML = marked.parse(ev.content ?? ""); m.scrollIntoView({ block: "nearest" }); break; }
    case "done": {
      state.messages.push(...ev.messages);
      const cached = ev.calls.filter((c) => c.cached).length;
      $("#calls").textContent = `${ev.calls.length} Qloo calls this turn${cached ? `, ${cached} cached` : ""}`;
      break;
    }
    case "error": showError(ev.message); break;
  }
}

// ---------- forms ----------
$("#start").addEventListener("submit", (e) => {
  e.preventDefault();
  const act = $("#act").value.trim(); if (!act) return;
  const kind = $("#kind").value;
  const regionName = $("#region").selectedOptions[0].textContent;
  const text = `Route a ${$("#stops").value}-stop tour for ${act} across ${regionName} (region code "${$("#region").value}").${kind ? ` Use ${kind} rooms.` : ""}`;
  // new act: reset the board
  state.messages = []; state.plans = {}; state.route = null; state.markets = {};
  Object.values(layers).forEach((l) => l.clearLayers()); for (const k in marketMarkers) delete marketMarkers[k];
  $("#steps").innerHTML = ""; document.querySelectorAll(".memo.user").forEach((n) => n.remove());
  $("#stops-list").innerHTML = ""; $("#markets").hidden = true; $("#crowd").hidden = true; $("#act-card").hidden = true; $("#print").hidden = true;
  $("#suggest").hidden = true;
  send(text);
});
$("#followup").addEventListener("submit", (e) => { e.preventDefault(); const t = $("#ask").value.trim(); if (!t) return; $("#ask").value = ""; send(t); });
document.querySelectorAll(".ex").forEach((b) => b.addEventListener("click", () => { $("#act").value = b.dataset.act; $("#kind").value = b.dataset.kind ?? ""; $("#start").requestSubmit(); }));
$("#print").addEventListener("click", () => window.print());

// typeahead against Qloo /search
let tmr;
$("#act").addEventListener("input", () => {
  clearTimeout(tmr);
  const q = $("#act").value.trim();
  if (q.length < 2) { $("#suggest").hidden = true; return; }
  tmr = setTimeout(async () => {
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then((x) => x.json()).catch(() => ({ results: [] }));
    const ul = $("#suggest");
    ul.innerHTML = r.results.map((e) => `<li data-name="${esc(e.name)}">${e.image ? `<img src="${esc(e.image)}" alt="">` : `<span style="width:30px"></span>`}<span>${esc(e.name)} <small>${esc((e.type ?? "").split(":").pop().replace("_", " "))}${e.disambiguation ? ", " + esc(e.disambiguation) : ""}</small></span></li>`).join("");
    ul.hidden = !r.results.length;
    ul.querySelectorAll("li").forEach((li) => li.addEventListener("click", () => { $("#act").value = li.dataset.name; ul.hidden = true; }));
  }, 250);
});
document.addEventListener("click", (e) => { if (!e.target.closest(".combo")) $("#suggest").hidden = true; });

fetch("/api/health").then((r) => r.json()).then((h) => { $("#mock").hidden = !h.mock; }).catch(() => {});
