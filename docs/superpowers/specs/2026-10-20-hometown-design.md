# Hometown: a tour-routing agent with taste

Qloo Agentic Hackathon entry (deadline Oct 30, 2026). Design spec, written 2026-10-20.

## Intent

Touring is where live acts make their money, and routing a tour is still guesswork plus Spotify
stream counts. Streams say where people press play. They do not say which rooms those people
drink in, which local openers they already follow, or which brands would pay to be on the bar
tab. Hometown is an agent that answers "where should this act play next, and what should the
night look like in each city" using Qloo's taste graph as the ground truth.

Pitch line: "Every act has hometowns it has never played. Hometown finds them."

Audience: artist managers, booking agents, independent musicians, touring comedians, podcast
hosts doing live shows, and brands planning pop-up tours. Judges on this panel run Live Nation
strategy, tour as comedians, own venues and hospitality, and invest in exactly this kind of SMB
tool, so the problem space is theirs.

## Why Qloo is the differentiator

An LLM alone can name big cities. It cannot say that fans of a specific act over-index in East
Nashville rather than downtown, that those fans also like a specific 400-cap room, which local
artists share that crowd, or which brands they love. Every one of those answers comes from a
Qloo call. Remove Qloo and the product is a city list.

Qloo surfaces used (all GET, base `https://hackathon.api.qloo.com`, header `X-Api-Key`):

| Question | Endpoint and key params |
|---|---|
| Who is this act | `/search?query=&types=urn:entity:artist,person,podcast,brand` |
| Where does the crowd live | `/v2/insights?filter.type=urn:heatmap&signal.interests.entities=ACT&filter.location.query=CITY` once per candidate city |
| Which rooms fit | `/v2/insights?filter.type=urn:entity:place&signal.interests.entities=ACT&filter.location=POINT(hotspot)&filter.location.radius=&filter.tags=VENUE_TAGS` |
| Pre and post show spots | same, with restaurant and bar tags |
| Who should open | `/v2/insights?filter.type=urn:entity:artist&signal.interests.entities=ACT&signal.location.query=CITY` |
| Who would sponsor | `/v2/insights?filter.type=urn:entity:brand&signal.interests.entities=ACT` |
| Who is the crowd | `/v2/insights?filter.type=urn:demographics&signal.interests.entities=ACT` and `filter.type=urn:tag` |
| Is the act rising | `/v2/trending?filter.type=&signal.interests.entities=ACT&filter.start_date=&filter.end_date=` |
| Tag IDs | `/v2/tags?filter.query=&filter.tag.types=urn:tag:genre:place` |

## Goals

- A manager types an act and a region and gets a routed tour book: ranked markets, hotspot
  map per city, venue shortlist, local openers, pre-show spots, sponsor targets, crowd profile,
  and a promoter-ready pitch paragraph per city.
- The agent is conversational: "swap Austin for Dallas", "comedy clubs not music venues",
  "who should open in Denver" all work as follow-ups and trigger new Qloo calls.
- Every Qloo call is visible in the UI as a step with its parameters, so judges can see the
  taste graph doing the work and distinguish Qloo evidence from LLM interpretation.
- Live, public, hosted demo. Public repo, MIT license.

## Non-goals

- Ticketing, holds, contracts, calendars, venue availability.
- User accounts or saved tours (a shareable export is enough).
- Mobile apps.

## Anti-goals

- A chatbot that could have answered without Qloo. If a screen does not show Qloo-grounded
  data, cut it.
- Inferring anything about an individual person. All signals are public acts, places, brands.
- Leaking the Qloo key to the browser or committing Qloo data to the public repo.

## Constraints

- Hackathon key is manually issued and may arrive days late. Everything must run against a
  mock Qloo layer (`QLOO_MOCK=1`) until then, and switch to live with only the secret set.
- Quota is finite. Cache every Qloo GET server-side (Cloudflare Cache API, 7 days). Fan-out is
  bounded: at most 30 heatmap calls per market ranking, run in parallel.
- Hackathon keys fail on `api.qloo.com`; base URL is `hackathon.api.qloo.com`.

## How it gets made (builder's calls)

- Cloudflare Worker, TypeScript, no web framework, static assets served by Workers Assets.
  Chosen because the account is already logged in with `wrangler` and the `shrikar.dev` zone,
  and sibling hackathon projects deploy this way.
- LLM: OpenAI chat completions with tool calling (`gpt-5.4`, env-configurable). It is the only
  LLM key on the machine. The provider is one small module so Claude can be swapped in.
- Agent shape: a tool-calling loop where tools are coarse Qloo workflows (rank markets, plan a
  city, find openers, find sponsors, crowd profile, momentum, find tag). The LLM plans and
  narrates; the tools do the fan-out. The browser receives server-sent events: one per tool
  call, one per tool result, one for the final memo.
- Frontend: one HTML page, vanilla JS, Leaflet from CDN with CARTO light tiles. Left column is
  the run sheet (prompt, agent steps, memo). Right is the map with numbered stops and a dashed
  route line, and the tour book of city cards.
- Conversation state lives in the browser and is resent each turn (stateless Worker). Tool
  results in history are compacted to what the LLM needs.
- Market score: per city, mean of the top 15 heatmap cells of `affinity * (0.5 + 0.5 *
  popularity)`. Calibrate against real data once the key arrives.

## Left to the builder

- Exact candidate city lists per region and the venue, bar and restaurant tag queries.
- Prompt wording and the tour-book card layout.
- Export format (print-to-PDF of the tour book is acceptable).
