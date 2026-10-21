import { test } from "node:test";
import assert from "node:assert/strict";
import { marketScore, runTool, forModel } from "../src/tools.ts";
import { Qloo } from "../src/qloo.ts";
import { citiesFor } from "../src/cities.ts";

const env: any = { QLOO_MOCK: "1", QLOO_BASE_URL: "https://hackathon.api.qloo.com", OPENAI_MODEL: "x", OPENAI_API_KEY: "x" };

test("marketScore ranks a strong city above a weak one and stays in 0-100", () => {
  const strong = Array.from({ length: 30 }, () => ({ rank: 0.95 }));
  const weak = Array.from({ length: 30 }, () => ({ rank: 0.3 }));
  assert.ok(marketScore(strong) > marketScore(weak));
  assert.ok(marketScore(strong) <= 100 && marketScore(weak) >= 0);
  assert.equal(marketScore([]), 0);
});

test("citiesFor falls back to US and accepts custom names", () => {
  assert.ok(citiesFor("nowhere").length > 20);
  assert.equal(citiesFor(undefined, ["nashville"])[0].q, "Nashville");
  assert.equal(citiesFor(undefined, ["Boise"])[0].name, "Boise");
});

test("end-to-end tool chain runs on the mock layer", async () => {
  const qloo = new Qloo(env);
  const events: any[] = [];
  const ctx = { qloo, emit: (e: any) => events.push(e) };
  const act = await runTool("resolve_act", { query: "Khruangbin" }, ctx);
  const id = act.candidates[0].entity_id;
  const ranked = await runTool("rank_markets", { entity_id: id, region: "us-south" }, ctx);
  assert.ok(ranked.markets.length >= 5);
  assert.ok(ranked.markets[0].score >= ranked.markets.at(-1).score);
  assert.equal(events.filter((e) => e.type === "market").length, ranked.markets.length);
  const plan = await runTool("plan_city", { entity_id: id, entity_type: "urn:entity:artist", city: ranked.markets[0].city, venue_kind: "music" }, ctx);
  assert.ok(plan.venues.length > 0 && plan.spots.length > 0 && plan.openers.length > 0);
  assert.ok(plan.venues[0].location, "venues carry coordinates for the map");
  const slim = forModel("plan_city", plan);
  assert.ok(!("cells" in slim), "model payload drops heatmap cells");
  const crowd = await runTool("crowd_profile", { entity_id: id }, ctx);
  assert.ok(Object.keys(crowd.age).length === 6);
  const trend = await runTool("momentum", { entity_id: id, entity_type: "urn:entity:artist" }, ctx);
  assert.ok(trend.points.length > 5);
  assert.ok(qloo.log.length > 10, "every Qloo call is logged for provenance");
});
