import { Qloo } from "./qloo.ts";
import { citiesFor, REGIONS, type City } from "./cities.ts";

export type Emit = (event: Record<string, unknown>) => void;
export interface Ctx { qloo: Qloo; emit: Emit }

const ACT_TYPES = ["urn:entity:artist", "urn:entity:person", "urn:entity:podcast", "urn:entity:brand", "urn:entity:tv_show"];

// OpenAI function schemas. Coarse-grained on purpose: each tool is a whole Qloo workflow, so the
// model makes ~10 calls per tour instead of 60.
export const TOOL_DEFS = [
  {
    type: "function", function: {
      name: "resolve_act",
      description: "Look up an act (music artist, comedian or other person, podcast, brand, TV show) in Qloo and return candidate entities with IDs. Always call this first. If the top candidates are close in popularity and differ in type or disambiguation, ask the user which one they mean.",
      parameters: { type: "object", properties: { query: { type: "string" }, type: { type: "string", enum: ACT_TYPES, description: "Restrict to one entity type when the user made it clear (e.g. 'the comedian')." } }, required: ["query"] },
    },
  },
  {
    type: "function", function: {
      name: "rank_markets",
      description: "Rank candidate cities by how strongly the act's crowd over-indexes there, using one Qloo heatmap per city. Returns a market score (0-100) per city plus hotspot cells. Use region for a standard list or cities for a custom list (max 30).",
      parameters: { type: "object", properties: { entity_id: { type: "string" }, region: { type: "string", enum: REGIONS }, cities: { type: "array", items: { type: "string" } } }, required: ["entity_id"] },
    },
  },
  {
    type: "function", function: {
      name: "plan_city",
      description: "Build the night in one city: the hotspot neighbourhood, a venue shortlist near it that the act's fans already have affinity for, pre-show restaurants and bars, and local acts who share the crowd and could open. Call once per chosen city; calls can run in parallel.",
      parameters: { type: "object", properties: { entity_id: { type: "string" }, entity_type: { type: "string", enum: ACT_TYPES }, city: { type: "string", description: "City name as returned by rank_markets" }, venue_kind: { type: "string", enum: ["music", "comedy", "theater", "club", "any"], description: "music for bands, comedy for comedians, theater for seated shows and podcasts" } }, required: ["entity_id", "entity_type", "city", "venue_kind"] },
    },
  },
  {
    type: "function", function: {
      name: "crowd_profile",
      description: "Describe the act's audience from Qloo: age and gender skew, and the taste tags that characterise the crowd.",
      parameters: { type: "object", properties: { entity_id: { type: "string" } }, required: ["entity_id"] },
    },
  },
  {
    type: "function", function: {
      name: "find_sponsors",
      description: "Brands the act's crowd over-indexes on, for tour sponsorship and local partnership pitches. Pass city to localise.",
      parameters: { type: "object", properties: { entity_id: { type: "string" }, city: { type: "string" } }, required: ["entity_id"] },
    },
  },
  {
    type: "function", function: {
      name: "momentum",
      description: "Weekly Qloo trending data for the act over the last six months: is interest rising or fading?",
      parameters: { type: "object", properties: { entity_id: { type: "string" }, entity_type: { type: "string", enum: ACT_TYPES } }, required: ["entity_id", "entity_type"] },
    },
  },
  {
    type: "function", function: {
      name: "find_tag",
      description: "Search Qloo's tag ontology for a concept (e.g. 'vinyl bar', 'jazz club', 'vegan') to use as a venue or spot filter in follow-up questions.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  },
  {
    type: "function", function: {
      name: "finalize_tour",
      description: "Lock the routed tour: ordered stops with the chosen venue and opener per city. Call this once, right before writing the final memo. Order stops geographically so the route makes sense to drive.",
      parameters: { type: "object", properties: { title: { type: "string" }, stops: { type: "array", items: { type: "object", properties: { city: { type: "string" }, venue: { type: "string" }, opener: { type: "string" }, why: { type: "string", description: "One sentence citing the Qloo evidence" } }, required: ["city", "venue", "why"] } } }, required: ["title", "stops"] },
    },
  },
];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const aff = (e: any): number => e?.query?.affinity ?? e?.affinity ?? 0;
const img = (e: any): string | undefined => e?.properties?.images?.[0]?.url ?? e?.properties?.image?.url ?? e?.properties?.image;
const latlon = (e: any): { lat: number; lon: number } | undefined => {
  const l = e?.location ?? e?.properties?.location ?? e?.properties?.geocode;
  const lat = l?.lat ?? l?.latitude, lon = l?.lon ?? l?.lng ?? l?.longitude;
  return typeof lat === "number" && typeof lon === "number" ? { lat, lon } : undefined;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

function compactPlace(e: any) {
  return {
    entity_id: e.entity_id, name: e.name, affinity: r2(aff(e)), popularity: r2(e.popularity ?? 0),
    address: e.properties?.address, rating: e.properties?.business_rating ? Math.round(e.properties.business_rating * 10) / 10 : undefined, price_level: e.properties?.price_level,
    website: e.properties?.website, image: img(e), location: latlon(e), area: e.properties?.geocode?.name,
    tags: (e.tags ?? []).slice(0, 5).map((t: any) => t.name).filter(Boolean),
  };
}
function compactEntity(e: any) {
  return { entity_id: e.entity_id, name: e.name, type: e.subtype ?? e.types?.[0], affinity: r2(aff(e)), popularity: r2(e.popularity ?? 0), image: img(e), tags: (e.tags ?? []).slice(0, 3).map((t: any) => t.name).filter(Boolean) };
}

/** Market score, 0 to 100, from heatmap affinity_rank. Qloo normalises `affinity` to 1 within
 * each city, so only `affinity_rank` compares across cities (Austin 0.97 vs Omaha 0.42 for Khruangbin). */
export function marketScore(cells: { rank: number }[]): number {
  if (!cells.length) return 0;
  const mean = (xs: { rank: number }[]) => xs.reduce((s, c) => s + c.rank, 0) / xs.length;
  const top = [...cells].sort((a, b) => b.rank - a.rank).slice(0, 15);
  // ponytail: half "how hot is the hottest pocket", half "how much of the city over-indexes"; the top-15 term alone
  // saturates at 100 for household-name acts.
  return Math.round((0.5 * mean(top) + 0.5 * mean(cells)) * 100);
}

function cells(res: any) {
  return ((res?.results?.heatmap ?? []) as any[]).map((h) => ({ lat: h.location?.latitude, lon: h.location?.longitude, affinity: h.query?.affinity ?? 0, rank: h.query?.affinity_rank ?? h.query?.affinity ?? 0, popularity: h.query?.popularity ?? 0 })).filter((c) => typeof c.lat === "number");
}

const VENUE_QUERIES: Record<string, string[]> = {
  music: ["live music venue", "concert hall"],
  comedy: ["comedy club"],
  theater: ["performing arts theater", "concert hall"],
  club: ["night club"],
  any: ["live music venue", "comedy club", "performing arts theater", "night club"],
};
const SPOT_QUERIES = ["restaurant", "bar"];

const tagCache = new Map<string, string[]>();
/** Resolve concept words to place tag IDs via /v2/tags, preferring genre/category place tags. */
async function placeTags(qloo: Qloo, queries: string[]): Promise<string[]> {
  const key = queries.join("|");
  if (tagCache.has(key)) return tagCache.get(key)!;
  const found = await Promise.all(queries.map(async (q) => {
    try {
      const res = await qloo.tags({ "filter.query": q, "filter.tag.types": "urn:tag:genre:place,urn:tag:category:place", take: 5 });
      const tags: any[] = res?.results?.tags ?? [];
      const exact = tags.find((t) => t.name?.toLowerCase() === q.toLowerCase());
      return ((exact ?? tags[0])?.id ?? (exact ?? tags[0])?.tag_id) as string | undefined;
    } catch { return undefined; }
  }));
  const ids = [...new Set(found.filter(Boolean) as string[])];
  tagCache.set(key, ids);
  return ids;
}

async function heatmap(qloo: Qloo, entity_id: string, city: City) {
  const res = await qloo.insights({ "filter.type": "urn:heatmap", "signal.interests.entities": entity_id, "filter.location.query": city.q });
  const cs = cells(res);
  const top = [...cs].sort((a, b) => b.affinity - a.affinity);
  const hot = top[0];
  const n = Math.min(10, top.length) || 1;
  const centroid = top.length ? { lat: top.slice(0, n).reduce((s, c) => s + c.lat, 0) / n, lon: top.slice(0, n).reduce((s, c) => s + c.lon, 0) / n } : { lat: city.lat, lon: city.lon };
  return { city: city.name, query: city.q, score: marketScore(cs), cell_count: cs.length, hotspot: hot ? { lat: hot.lat, lon: hot.lon, affinity: r2(hot.affinity) } : undefined, centroid, cells: top.slice(0, 25).map((c) => ({ lat: c.lat, lon: c.lon, affinity: r2(c.affinity), popularity: r2(c.popularity) })) };
}

// ---------------------------------------------------------------------------
// tool implementations
// ---------------------------------------------------------------------------
export async function runTool(name: string, args: any, ctx: Ctx): Promise<any> {
  const { qloo } = ctx;
  switch (name) {
    case "resolve_act": {
      const types = args.type ? [args.type] : ACT_TYPES;
      const res = await qloo.search(args.query, types, 6);
      const results: any[] = res?.results ?? [];
      return { candidates: results.slice(0, 6).map((e) => ({ entity_id: e.entity_id, name: e.name, type: e.types?.[0] ?? e.subtype, popularity: r2(e.popularity ?? 0), disambiguation: e.disambiguation || undefined, image: img(e) })) };
    }
    case "rank_markets": {
      const list = citiesFor(args.region, args.cities).slice(0, 30);
      const markets = await Promise.all(list.map(async (city) => {
        try {
          const m = await heatmap(qloo, args.entity_id, city);
          ctx.emit({ type: "market", market: m });
          return m;
        } catch (e: any) {
          return { city: city.name, query: city.q, score: 0, cell_count: 0, centroid: { lat: city.lat, lon: city.lon }, cells: [], error: String(e.message ?? e).slice(0, 120) };
        }
      }));
      markets.sort((a, b) => b.score - a.score);
      return { region: args.region ?? (args.cities ? "custom" : "us"), markets };
    }
    case "plan_city": {
      const city = citiesFor(undefined, [args.city])[0];
      const hm = await heatmap(qloo, args.entity_id, city);
      const point = hm.hotspot ?? hm.centroid;
      const wkt = `POINT(${point.lon.toFixed(5)} ${point.lat.toFixed(5)})`;
      const kind = args.venue_kind in VENUE_QUERIES ? args.venue_kind : "any";
      const [venueTags, spotTags] = await Promise.all([placeTags(qloo, VENUE_QUERIES[kind]), placeTags(qloo, SPOT_QUERIES)]);
      const base = { "signal.interests.entities": args.entity_id, "filter.location": wkt, "filter.location.radius": 6000, take: 10 };
      const openerType = args.entity_type === "urn:entity:person" ? "urn:entity:person" : args.entity_type === "urn:entity:podcast" ? "urn:entity:podcast" : "urn:entity:artist";
      const [venuesRes, spotsRes, openersRes] = await Promise.all([
        qloo.insights({ "filter.type": "urn:entity:place", ...base, "filter.tags": venueTags.join(",") || undefined, "operator.filter.tags": venueTags.length > 1 ? "union" : undefined, "sort_by": "affinity" }),
        qloo.insights({ "filter.type": "urn:entity:place", ...base, "filter.tags": spotTags.join(",") || undefined, "operator.filter.tags": spotTags.length > 1 ? "union" : undefined, take: 8, "filter.popularity.min": 0.3 }),
        qloo.insights({ "filter.type": openerType, "signal.interests.entities": args.entity_id, "signal.location.query": city.q, take: 8, "filter.popularity.max": 0.9 }),
      ]);
      let venueEntities: any[] = venuesRes?.results?.entities ?? [];
      if (!venueEntities.length && venueTags.length) { // nothing tagged within 6 km of the hotspot: widen to the whole city
        const wide = await qloo.insights({ "filter.type": "urn:entity:place", "signal.interests.entities": args.entity_id, "filter.location.query": city.q, "filter.tags": venueTags.join(","), "operator.filter.tags": venueTags.length > 1 ? "union" : undefined, "sort_by": "affinity", take: 10 });
        venueEntities = wide?.results?.entities ?? [];
      }
      const venues = venueEntities.map(compactPlace);
      const spots = (spotsRes?.results?.entities ?? []).map(compactPlace);
      const openers = (openersRes?.results?.entities ?? []).map(compactEntity).filter((o: any) => o.entity_id !== args.entity_id);
      return { city: city.name, score: hm.score, hotspot: point, cells: hm.cells, venue_tags: venueTags, venues, spots, openers };
    }
    case "crowd_profile": {
      const [demo, tags] = await Promise.all([
        qloo.insights({ "filter.type": "urn:demographics", "signal.interests.entities": args.entity_id }),
        qloo.insights({ "filter.type": "urn:tag", "signal.interests.entities": args.entity_id, "filter.tag.types": "urn:tag:genre:music,urn:tag:genre:media,urn:tag:style:qloo,urn:tag:theme:qloo,urn:tag:keyword:qloo", take: 15 }),
      ]);
      const d = demo?.results?.demographics?.[0]?.query ?? {};
      return { age: d.age ?? {}, gender: d.gender ?? {}, tags: (tags?.results?.tags ?? []).map((t: any) => ({ name: t.name, affinity: r2(aff(t)), kind: String(t.subtype ?? "").split(":")[2] })) };
    }
    case "find_sponsors": {
      const res = await qloo.insights({ "filter.type": "urn:entity:brand", "signal.interests.entities": args.entity_id, "signal.location.query": args.city ? citiesFor(undefined, [args.city])[0].q : undefined, take: 12 });
      return { city: args.city, brands: (res?.results?.entities ?? []).map(compactEntity) };
    }
    case "momentum": {
      const end = new Date(), start = new Date(end.getTime() - 26 * 7 * 86400000);
      const res = await qloo.trending({ "filter.type": args.entity_type, "signal.interests.entities": args.entity_id, "filter.start_date": start.toISOString().slice(0, 10), "filter.end_date": end.toISOString().slice(0, 10), take: 30 });
      const pts = ((res?.results?.trending ?? []) as any[]).map((p) => ({ date: p.date, percentile: p.population_percentile, rank: p.population_rank, velocity: p.velocity_fold_change ?? p.population_rank_velocity })).sort((a, b) => a.date.localeCompare(b.date));
      const first = pts[0]?.percentile, last = pts.at(-1)?.percentile;
      const flat = pts.length > 1 && pts.every((p) => p.percentile === pts[0].percentile);
      return { points: pts, flat, percentile: last, rank: pts.at(-1)?.rank, change: first !== undefined && last !== undefined ? r2(last - first) : undefined };
    }
    case "find_tag": {
      const res = await qloo.tags({ "filter.query": args.query, "feature.semantic_search": true, take: 8 });
      return { tags: (res?.results?.tags ?? []).map((t: any) => ({ tag_id: t.id ?? t.tag_id, name: t.name, subtype: t.type ?? t.subtype })) };
    }
    case "finalize_tour":
      return { ok: true, title: args.title, stops: args.stops };
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

/** What the model sees. Heavy map data is dropped; the browser already received it via events. */
export function forModel(name: string, result: any): any {
  if (name === "rank_markets") return { region: result.region, markets: result.markets.slice(0, 12).map((m: any) => ({ city: m.city, score: m.score, cells: m.cell_count, hotspot: m.hotspot, error: m.error })) , note: `${result.markets.length} cities ranked; top 12 shown` };
  if (name === "plan_city") {
    const slim = (p: any) => ({ name: p.name, affinity: p.affinity, rating: p.rating, price_level: p.price_level, address: p.address, tags: p.tags });
    return { city: result.city, score: result.score, venue_tags: result.venue_tags, venues: result.venues.slice(0, 6).map(slim), spots: result.spots.slice(0, 5).map(slim), openers: result.openers.slice(0, 6).map((o: any) => ({ name: o.name, affinity: o.affinity, popularity: o.popularity, tags: o.tags })) };
  }
  if (name === "momentum") return { change: result.change, first: result.points[0], last: result.points.at(-1), points: result.points.length };
  if (name === "find_sponsors") return { city: result.city, brands: result.brands.map((b: any) => ({ name: b.name, affinity: b.affinity, tags: b.tags })) };
  return result;
}
