# Hometown

**A tour-routing agent with taste.** Tell it who is touring. It finds the cities where that
act's crowd already over-indexes, then builds the night in each one: the room fans already
like, the local act who should open, where the crowd eats before the show, and which brands
would sponsor the run. Every answer is measured in Qloo's taste graph, not guessed by a model.

Built for the Qloo Agentic Hackathon, October 2026.

**Live demo:** https://hometown.shrikar84.workers.dev
**Demo video (2 min):** https://hometown.shrikar84.workers.dev/demo.mp4
**Source:** https://github.com/sarchak/hometown

## The problem

Touring is where live acts earn, and routing a tour is still guesswork plus streaming counts.
Streams say where people press play. They do not say which 400-cap room those people drink in,
which local openers they already follow, or which brands would pay to be on the bar tab.
Managers, booking agents, touring comedians and podcasters make these calls on gut feel today.

## Why only Qloo makes this work

An LLM alone can list big cities. It cannot say that fans of a specific act cluster in East
Nashville rather than downtown, that those fans have affinity for a specific venue, which local
artists share that crowd, or which brands they love. Each of those is one Qloo call. Remove
Qloo and the product is a city list.

| Question the agent answers | Qloo call |
|---|---|
| Who is this act | `GET /search` across artist, person, podcast, brand, tv_show |
| Where does the crowd live | `GET /v2/insights` `filter.type=urn:heatmap` once per candidate city, up to 30 in parallel |
| Which rooms fit | `filter.type=urn:entity:place` with `signal.interests.entities`, `filter.location=POINT(hotspot)` and venue tags resolved from `/v2/tags` |
| Where to eat before the show | same, with restaurant and bar tags |
| Who should open | `filter.type=urn:entity:artist` (or person, podcast) with `signal.location.query=city` |
| Who would sponsor | `filter.type=urn:entity:brand` |
| Who is the crowd | `filter.type=urn:demographics` and `filter.type=urn:tag` |
| Is the act rising | `GET /v2/trending`, weekly, last six months |

## How the agent works

The model (OpenAI, tool calling) plans and narrates. Eight coarse tools do the Qloo work:
`resolve_act`, `rank_markets`, `plan_city`, `crowd_profile`, `find_sponsors`, `momentum`,
`find_tag`, `finalize_tour`. A typical tour is about 12 tool calls and 50 to 60 Qloo requests.
The browser receives server-sent events for every tool call and result, so the map lights up
city by city as heatmaps return and the run sheet shows exactly which Qloo inputs produced each
answer. Follow-ups ("swap Austin for Dallas", "comedy clubs instead", "who should open in
Denver") call only the tools they need.

Market score is the mean affinity of the hottest 15 heatmap cells in a city, weighted by local
popularity, scaled 0 to 100. It is shown next to the raw cell counts so judges can tell Qloo's
numbers from our interpretation.

## Run it

```sh
npm install
cp .dev.vars.example .dev.vars   # add QLOO_API_KEY and OPENAI_API_KEY
npm run dev                      # http://localhost:8787
npm test                         # tool chain against the mock layer
```

Without a Qloo key the app runs on a synthetic mock layer (`QLOO_MOCK=1`) so the UI and agent
loop can be developed. Nothing in the mock is Qloo data, and no Qloo data is committed here.

Deploy: `npx wrangler secret put QLOO_API_KEY`, `npx wrangler secret put OPENAI_API_KEY`,
then `npm run deploy`. The Worker caches every Qloo GET for a week in the Cloudflare cache so
repeated demos do not burn quota. The browser never talks to Qloo directly.

## Responsible use

Signals are public acts, places and brands. No personal data is sent to Qloo. Results are
aggregate affinities and are labelled as such in the UI and memo. Affinity is a measure of
taste fit, not a ticket demand forecast, and the agent says so in every memo.

## Stack

Cloudflare Worker (TypeScript, no framework), static HTML/CSS/JS, Leaflet with OpenStreetMap tiles,
OpenAI chat completions with tools. MIT licensed. The demo video is a HyperFrames composition in
`videos/hometown-demo` (one Playwright take of the live site, ElevenLabs narration); the clips, narration
and renders are not committed.
