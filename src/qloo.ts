import { CITIES } from "./cities.ts";

export interface Env {
  QLOO_API_KEY?: string;
  QLOO_BASE_URL: string;
  QLOO_MOCK: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  ASSETS: Fetcher;
}

export type Params = Record<string, string | number | boolean | undefined>;
export interface CallLog { path: string; params: Params; ms: number; cached: boolean; ok: boolean }

export class QlooError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const WEEK = 60 * 60 * 24 * 7;

/** Thin GET client. Every call is logged (for the UI's provenance view) and cached for a week. */
export class Qloo {
  log: CallLog[] = [];
  constructor(private env: Env) {}

  get mock() { return this.env.QLOO_MOCK === "1" || !this.env.QLOO_API_KEY; }

  async get(path: string, params: Params): Promise<any> {
    const url = new URL(path, this.env.QLOO_BASE_URL);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    const t0 = Date.now();
    if (this.mock) {
      const data = mockResponse(path, url.searchParams);
      this.log.push({ path, params, ms: Date.now() - t0, cached: false, ok: true });
      return data;
    }
    const cache = (globalThis as any).caches?.default as Cache | undefined;
    const cacheKey = new Request(url.toString());
    const hit = await cache?.match(cacheKey);
    if (hit) {
      this.log.push({ path, params, ms: Date.now() - t0, cached: true, ok: true });
      return hit.json();
    }
    const res = await fetch(url, { headers: { "X-Api-Key": this.env.QLOO_API_KEY! } });
    const text = await res.text();
    this.log.push({ path, params, ms: Date.now() - t0, cached: false, ok: res.ok });
    if (!res.ok) throw new QlooError(res.status, `Qloo ${res.status} on ${path}: ${text.slice(0, 300)}`);
    const data = JSON.parse(text);
    if (cache) await cache.put(cacheKey, new Response(text, { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${WEEK}` } }));
    return data;
  }

  search(query: string, types: string[], take = 6) {
    return this.get("/search", { query, types: types.join(","), take });
  }
  insights(params: Params) { return this.get("/v2/insights", params); }
  tags(params: Params) { return this.get("/v2/tags", params); }
  trending(params: Params) { return this.get("/v2/trending", params); }
}

// ---------------------------------------------------------------------------
// Mock layer: deterministic synthetic data so the agent and UI run before the
// hackathon key arrives. Nothing here is Qloo data.
// ---------------------------------------------------------------------------
function hash(s: string) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rnd(seed: string) { let x = hash(seed) || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 10000) / 10000; }; }
const uuid = (s: string) => { const h = hash(s).toString(16).padStart(8, "0").toUpperCase(); return `${h}-MOCK-4000-8000-${hash(s + "x").toString(16).padStart(12, "0").toUpperCase().slice(0, 12)}`; };
const pick = <T,>(arr: T[], r: () => number) => arr[Math.floor(r() * arr.length)];

const VENUE_WORDS = ["The Basement", "Union Hall", "Paper Tiger", "Mohawk", "Bluebird", "The Echo", "Neumos", "Lincoln Hall", "Terminal West", "Royale", "Mercury Lounge", "The Independent", "Globe Hall", "Cat's Cradle", "Vaudeville Mews", "Turf Club"];
const FOOD_WORDS = ["Cafe", "Cantina", "Taproom", "Kitchen", "Oyster Bar", "Smokehouse", "Wine Bar", "Noodle House", "Diner", "Brewing"];
const ARTIST_WORDS = ["Low Tide", "Paper Saints", "Hollow Coves", "Night Market", "Sable", "The Deltas", "Marigold", "Juniper Hill", "Static Bloom", "Honey Creek", "Vantage", "Little Wars"];
const BRANDS = ["Liquid Death", "Vans", "Fender", "Topo Chico", "Carhartt", "Levi's", "Polaroid", "Hydro Flask", "Patagonia", "Crocs", "Spotify", "Red Bull", "Doc Martens", "Dr. Squatch", "Celsius"];
const TAGS = ["Intimate", "Indie", "Late Night", "Craft Beer", "Vinyl", "Outdoorsy", "Tacos", "Dive Bar", "Festival", "Cozy", "Eclectic", "Hipster", "Family Friendly", "Nostalgic", "Energetic"];

function cityCenter(q: string | null) {
  const hit = q && CITIES.find((c) => c.q.toLowerCase() === q.toLowerCase() || c.name.toLowerCase() === q.toLowerCase());
  return hit ? { lat: hit.lat, lon: hit.lon } : { lat: 36.1627, lon: -86.7816 };
}

function mockResponse(path: string, p: URLSearchParams): any {
  const type = p.get("filter.type") ?? "";
  const seed = (p.get("signal.interests.entities") ?? "") + "|" + (p.get("filter.location.query") ?? p.get("signal.location.query") ?? p.get("filter.location") ?? "");
  const r = rnd(path + seed + type + (p.get("filter.tags") ?? ""));
  const take = Number(p.get("take") ?? 20);

  if (path === "/search") {
    const q = p.get("query") ?? "Act";
    const types = (p.get("types") ?? "urn:entity:artist").split(",");
    return { success: true, results: types.slice(0, 3).map((t, i) => ({ name: i === 0 ? q : `${q} (${t.split(":").pop()})`, entity_id: uuid(q + t), types: [t], popularity: Math.max(0.2, 0.99 - i * 0.3), properties: { image: { url: `https://picsum.photos/seed/${hash(q + t)}/200` } }, disambiguation: i === 0 ? "" : "Also known as" })) };
  }
  if (path === "/v2/tags") {
    const q = p.get("filter.query") ?? "tag";
    const tt = p.get("filter.tag.types") ?? "urn:tag:genre:place";
    return { success: true, results: { tags: [{ tag_id: `${tt}:${q.toLowerCase().replace(/\s+/g, "_")}`, name: q, subtype: tt, types: ["urn:entity:place"] }] } };
  }
  if (path === "/v2/trending") {
    const pts = []; const d = new Date(p.get("filter.end_date") ?? Date.now());
    for (let i = 0; i < Math.min(take, 26); i++) { pts.push({ date: new Date(d.getTime() - i * 7 * 86400000).toISOString().slice(0, 10), population_percentile: 60 + 30 * r() , population_rank: Math.floor(100 + 500 * r()), velocity_fold_change: 0.8 + 0.6 * r() }); }
    return { success: true, results: { trending: pts } };
  }
  if (type === "urn:heatmap") {
    const { lat, lon } = cityCenter(p.get("filter.location.query"));
    const cityBias = r();
    const heatmap = Array.from({ length: 40 }, () => {
      const a = Math.min(1, Math.max(0.05, cityBias * 0.6 + r() * 0.6));
      return { location: { latitude: lat + (r() - 0.5) * 0.25, longitude: lon + (r() - 0.5) * 0.3, geohash: "mock" }, query: { affinity: a, affinity_rank: a * 0.98, popularity: Math.min(1, 0.3 + r() * 0.7) } };
    });
    return { success: true, results: { heatmap } };
  }
  if (type === "urn:demographics") {
    const v = () => Math.round((r() * 1.4 - 0.6) * 100) / 100;
    return { success: true, results: { demographics: [{ entity_id: p.get("signal.interests.entities"), query: { age: { "24_and_younger": v(), "25_to_29": v(), "30_to_34": v(), "35_to_44": v(), "45_to_54": v(), "55_and_older": v() }, gender: { male: 0.12, female: -0.12 } } }] } };
  }
  if (type === "urn:tag") {
    return { success: true, results: { tags: TAGS.slice(0, take).map((t) => ({ tag_id: `urn:tag:keyword:qloo:${t.toLowerCase().replace(/\s/g, "_")}`, name: t, subtype: "urn:tag:keyword:qloo", query: { affinity: Math.round((0.6 + r() * 0.4) * 1000) / 1000 } })) } };
  }
  if (type === "urn:entity:place") {
    const loc = p.get("filter.location") ?? "";
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(loc);
    const center = m ? { lon: Number(m[1]), lat: Number(m[2]) } : cityCenter(p.get("filter.location.query"));
    const words = (p.get("filter.tags") ?? "").includes("restaurant") || (p.get("filter.tags") ?? "").includes("bar") ? FOOD_WORDS : VENUE_WORDS;
    const entities = Array.from({ length: Math.min(take, 10) }, (_, i) => {
      const name = words === FOOD_WORDS ? `${pick(["Lou's", "Marta's", "Eastside", "Ninth Street", "Golden Hour", "Blue Door"], r)} ${pick(FOOD_WORDS, r)}` : `${pick(VENUE_WORDS, r)}${i ? " " + pick(["East", "West", "Annex", "Ballroom", "Hall"], r) : ""}`;
      return { name, entity_id: uuid(name + seed), type: "urn:entity", subtype: "urn:entity:place", popularity: 0.5 + r() * 0.5, query: { affinity: Math.round((0.98 - i * 0.05 - r() * 0.03) * 1000) / 1000 }, location: { lat: center.lat + (r() - 0.5) * 0.04, lon: center.lon + (r() - 0.5) * 0.05 }, properties: { address: `${Math.floor(100 + r() * 2900)} ${pick(["Main", "Woodland", "5th", "Broadway", "Division", "Elm"], r)} St`, business_rating: Math.round((3.8 + r() * 1.2) * 10) / 10, price_level: 1 + Math.floor(r() * 3), image: { url: `https://picsum.photos/seed/${hash(name)}/320/200` }, website: "https://example.com", geocode: { city: p.get("filter.location.query") ?? "" } }, tags: TAGS.slice(0, 4).map((t) => ({ name: t, id: `urn:tag:keyword:qloo:${t.toLowerCase()}` })) };
    });
    return { success: true, results: { entities } };
  }
  if (type === "urn:entity:brand") {
    return { success: true, results: { entities: BRANDS.slice(0, take).map((b, i) => ({ name: b, entity_id: uuid(b), subtype: "urn:entity:brand", popularity: 0.6 + r() * 0.4, query: { affinity: Math.round((0.97 - i * 0.04) * 1000) / 1000 }, properties: { image: { url: `https://picsum.photos/seed/${hash(b)}/120` } }, tags: [{ name: pick(["Beverage", "Apparel", "Audio", "Outdoor"], r) }] })) } };
  }
  // artists / people / podcasts
  return { success: true, results: { entities: ARTIST_WORDS.slice(0, take).map((a, i) => ({ name: a, entity_id: uuid(a + seed), subtype: type, popularity: 0.2 + r() * 0.5, query: { affinity: Math.round((0.96 - i * 0.05) * 1000) / 1000 }, properties: { image: { url: `https://picsum.photos/seed/${hash(a)}/120` } }, tags: [{ name: pick(["Indie Rock", "Americana", "Hip Hop", "Comedy", "Folk", "Electronic"], r) }] })) } };
}
