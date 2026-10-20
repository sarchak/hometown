import { Qloo, type Env } from "./qloo.ts";
import { runAgent, type Msg } from "./agent.ts";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, mock: env.QLOO_MOCK === "1" || !env.QLOO_API_KEY, model: env.OPENAI_MODEL });
    }

    // Typeahead for the act input. Uses Qloo /search directly.
    if (url.pathname === "/api/search") {
      const q = url.searchParams.get("q")?.trim() ?? "";
      if (q.length < 2) return json({ results: [] });
      const qloo = new Qloo(env);
      try {
        const res = await qloo.search(q, ["urn:entity:artist", "urn:entity:person", "urn:entity:podcast", "urn:entity:brand"], 6);
        return json({ results: (res?.results ?? []).map((e: any) => ({ entity_id: e.entity_id, name: e.name, type: e.types?.[0], popularity: e.popularity, image: e.properties?.image?.url, disambiguation: e.disambiguation })) });
      } catch (e: any) { return json({ results: [], error: String(e.message) }, 502); }
    }

    if (url.pathname === "/api/agent" && request.method === "POST") {
      if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY is not set" }, 500);
      let body: { messages?: Msg[] };
      try { body = await request.json(); } catch { return json({ error: "Body must be JSON" }, 400); }
      const messages = (body.messages ?? []).filter((m) => ["user", "assistant", "tool"].includes(m.role)).slice(-60);
      if (!messages.length || messages.at(-1)!.role !== "user") return json({ error: "Last message must be from the user" }, 400);

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const enc = new TextEncoder();
      const emit = (event: Record<string, unknown>) => { writer.write(enc.encode(`data: ${JSON.stringify(event)}\n\n`)).catch(() => {}); };
      const qloo = new Qloo(env);

      (async () => {
        try {
          const added = await runAgent({ messages, emit, env, qloo });
          emit({ type: "done", messages: added, calls: qloo.log, mock: qloo.mock });
        } catch (e: any) {
          emit({ type: "error", message: String(e.message ?? e).slice(0, 500), calls: qloo.log });
        } finally {
          await writer.close().catch(() => {});
        }
      })();

      return new Response(readable, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
