/**
 * Read one recorded run of `reduck/chatgpt.com/ask` (`pnpm ingest` keeps it verbatim as
 * `record.json`) as what the page draws: its chat, and the pages its searches returned.
 *
 * A record is the Reduck run as stored: `{id, script, args, device, browser, status, startedAt,
 * finishedAt, result}`, `result` being the script's own output, whose contract is the script's
 * (read it with `read_script`). The parts this file relies on:
 * - `searches`: one entry per round, the queries typed and every result, each with its `ref`.
 * - `calls`: the same results split by search call, each with its `rank` in that call's list.
 * - `references`: what the answer cited, each with the `ref` of the result it points to.
 * - Signed out, `searches` and `calls` are null: ChatGPT shows only the citations, and a ref
 *   (`turn<call><type><rank>`) is then the one trace of the call and rank behind a page.
 *
 * ChatGPT gives no time per step, so every search sits at the run's start and the answer at its end.
 */
import { readFileSync } from "node:fs";
import type { Step } from "./replay/chat/chat.ts";
import { pageKey, type Page, type RunWithSession } from "./replay/run.ts";

type Result = { ref: string; url: string; title: string | null; type: string; rank?: number };

/** A ref as ChatGPT writes it: the call, the result's type, its rank in that call. */
const REF = /^turn(\d+)([a-z_]+?)(\d+)$/;

export function parseAsk(path: string): Pick<RunWithSession, "session" | "pages"> & {
	ask: string;
	answer: string;
	wallMs: number;
} {
	const record = JSON.parse(readFileSync(path, "utf8"));
	const r = record.result;
	const ask: string = record.args.question;
	const start: string = record.startedAt;
	const end: string = record.finishedAt ?? start;

	const citedRefs = new Set(r.references.map((c: { ref: string | null }) => c.ref).filter(Boolean));
	const citedUrls = new Set(r.references.map((c: { url: string }) => pageKey(c.url)));

	// Calls numbered from 1 in the order they first appear.
	const calls: string[] = [];
	const callOf = (id: string) => {
		if (!calls.includes(id)) calls.push(id);
		return calls.indexOf(id) + 1;
	};

	const pages: Page[] = [];
	if (r.calls) {
		const queriesOf = new Map<string, string[]>();
		for (const s of r.searches) for (const res of s.results) queriesOf.set(res.ref, s.queries);
		for (const c of r.calls)
			for (const res of c.results as Result[])
				pages.push({
					ref: res.ref,
					url: res.url,
					title: res.title,
					call: callOf(String(c.call)),
					rank: res.rank ?? null,
					type: res.type,
					queries: queriesOf.get(res.ref) ?? null,
					cited: citedRefs.has(res.ref) || citedUrls.has(pageKey(res.url))
				});
	}
	// Every citation no search result accounts for: all of them signed out, a page the model
	// opened (`view`) or a plain link signed in.
	const listed = new Set(pages.map((p) => pageKey(p.url)));
	for (const c of r.references as { ref: string | null; url: string; title: string }[]) {
		if (listed.has(pageKey(c.url))) continue;
		listed.add(pageKey(c.url));
		const m = c.ref?.match(REF);
		pages.push({
			ref: c.ref,
			url: c.url,
			title: c.title,
			call: m ? callOf(m[1]) : null,
			rank: m ? Number(m[3]) : null,
			type: m ? m[2] : null,
			queries: null,
			cited: true
		});
	}

	// One tool step per search round, labelled by what it typed; then the answer.
	const tool = (query: string, results: unknown): Step => ({
		kind: "tool",
		at: start,
		end: start,
		tool: "web.run",
		input: { query },
		error: false,
		result: JSON.stringify(results),
		images: []
	});
	const steps: Step[] = r.searches
		? r.searches.map((s: { queries: string[]; results: unknown }) => tool(s.queries.join(" · "), s.results))
		: calls.map((_, i) =>
				tool("queries not shown signed out", pages.filter((p) => p.call === i + 1))
			);
	for (const text of r.answers as string[]) steps.push({ kind: "text", at: end, text });

	return {
		ask,
		answer: r.answer,
		wallMs: Date.parse(end) - Date.parse(start),
		pages,
		session: {
			ask,
			start,
			durationMs: Date.parse(end) - Date.parse(start),
			steps,
			models: [r.model ?? r.searchContext?.requestedModel ?? "model not reported"]
		}
	};
}
