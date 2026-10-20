import type { Env } from "./qloo.ts";
import { Qloo } from "./qloo.ts";
import { TOOL_DEFS, runTool, forModel, type Emit } from "./tools.ts";

export type Msg = { role: "system" | "user" | "assistant" | "tool"; content?: string | null; tool_calls?: any[]; tool_call_id?: string; name?: string };

const SYSTEM = `You are Hometown, a tour-routing strategist for live acts: musicians, comedians, podcasters, and brands running pop-up tours. You work for the act's manager. Your edge is Qloo's taste graph: you never guess where a crowd is, you measure it.

Process for a new act:
1. resolve_act. If the top candidates are ambiguous (similar popularity, different types or disambiguation), stop and ask the user which one; otherwise take the top match and say which one you took.
2. rank_markets for the requested region (default "us"). Use the user's city list if they gave one.
3. Pick the stops. Default to the top 5 markets unless the user asked for a number or named cities. Prefer markets with a real hotspot and no error.
4. plan_city for every stop, in parallel, with venue_kind matching the act (music for artists, comedy for comedians, theater for podcasts and seated shows). Run crowd_profile, one find_sponsors (no city, unless the user asks about a specific city) and momentum in the same batch.
5. finalize_tour with stops ordered as a drivable route, one venue and one opener each, and a one-line "why" that cites the Qloo numbers.
6. Write the memo.

Memo format (markdown, under 450 words, the cards already hold the data):
- One-paragraph read on the act's crowd: age skew, taste tags, momentum. Say "Qloo shows" for measured facts and "I read this as" for your interpretation.
- One short section per stop, in route order: the market score, the venue pick and why (affinity, rating, price), the opener pick, one pre-show spot, and the sponsor angle. Name a neighbourhood only if a venue address clearly states one; otherwise do not mention neighbourhoods at all.
- A final paragraph: what to pitch promoters, and one honest limitation (affinity is aggregate taste, not ticket demand).

Rules: Never invent venues, acts, brands or numbers; only use what tools returned. If a tool returned an error or nothing, say so and move on. Never use em dashes. Plain, specific, promoter-ready language. For follow-ups (swap a city, change venue kind, who should open somewhere) call only the tools you need and answer briefly. If a follow-up changes the stops, their order, a venue or an opener, call finalize_tour again with the full updated route before answering, so the tour book and map stay current. If the user's swap is weaker on the Qloo numbers, say so plainly, then do what they asked.`;

interface Chat { messages: Msg[]; emit: Emit; env: Env; qloo: Qloo }

async function chat(env: Env, messages: Msg[]) {
  const body: any = { model: env.OPENAI_MODEL, messages, tools: TOOL_DEFS, tool_choice: "auto", parallel_tool_calls: true };
  if (/^gpt-5/.test(env.OPENAI_MODEL)) body.reasoning_effort = "low";
  let res = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: JSON.stringify(body) });
  if (!res.ok && body.reasoning_effort) {
    delete body.reasoning_effort;
    res = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: JSON.stringify(body) });
  }
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data: any = await res.json();
  return data.choices[0].message as Msg;
}

/** Runs the tool loop. Emits SSE-able events and returns the new messages to append to history. */
export async function runAgent({ messages, emit, env, qloo }: Chat): Promise<Msg[]> {
  const history: Msg[] = [{ role: "system", content: SYSTEM }, ...messages];
  const added: Msg[] = [];
  for (let step = 0; step < 12; step++) {
    const msg = await chat(env, history);
    history.push(msg); added.push(msg);
    if (!msg.tool_calls?.length) {
      emit({ type: "message", content: msg.content ?? "" });
      return added;
    }
    const results = await Promise.all(msg.tool_calls.map(async (tc: any) => {
      const name = tc.function.name;
      let args: any = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* leave empty */ }
      emit({ type: "tool_call", id: tc.id, name, args });
      const t0 = Date.now();
      try {
        const result = await runTool(name, args, { qloo, emit });
        emit({ type: "tool_result", id: tc.id, name, args, result, ms: Date.now() - t0 });
        return { role: "tool", tool_call_id: tc.id, name, content: JSON.stringify(forModel(name, result)) } as Msg;
      } catch (e: any) {
        const error = String(e.message ?? e).slice(0, 300);
        emit({ type: "tool_result", id: tc.id, name, args, error, ms: Date.now() - t0 });
        return { role: "tool", tool_call_id: tc.id, name, content: JSON.stringify({ error }) } as Msg;
      }
    }));
    history.push(...results); added.push(...results);
  }
  emit({ type: "message", content: "I ran out of steps before finishing. Ask me to continue." });
  return added;
}
