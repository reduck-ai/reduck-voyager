/**
 * A Hermes Agent session, read into the same `Session` that `session.ts` makes of a Claude Code
 * transcript, so a task's `check`, the MCP and the replay read either one the same way.
 *
 * Hermes keeps a profile's sessions in `<HERMES_HOME>/state.db` (SQLite): one row per message,
 * OpenAI-shaped (`assistant.tool_calls`, then one `tool` row per result). It keeps only totals of
 * token usage, so what each API call held in its context comes from `calls.jsonl`, written by
 * the `post_api_request` hook in `hermes-hook.py`.
 *
 * Hermes defers MCP tools behind `tool_search` / `tool_describe` / `tool_call`: the model calls
 * `tool_call` with `{calls: [{name, arguments}]}`. A step is drawn as the MCP tool it reached
 * (`mcp__reduck__run_script`), like Claude Code's own steps, with the wrapper's inner arguments.
 * The deferral calls themselves stay steps, as Claude Code's `ToolSearch` does.
 *
 * An image an MCP tool returns (a screenshot) is cached on disk and named in the result as
 * `MEDIA:<path>`; it is read back as the step's image. `browser_exec` names its screenshot as
 * `"screenshot_path"`, and writes every one of a session to the same file: that file is the last
 * one taken, so only the last step naming it gets it.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Image, Step, ToolStep } from "./replay/chat/chat.ts";
import type { Session, Tokens } from "./session.ts";

/** One line of `calls.jsonl`: Hermes' normalized usage of one main-loop API call. */
export type Call = {
	session_id: string;
	api_call_count: number;
	model: string;
	started_at: number;
	ended_at: number;
	finish_reason: string;
	usage: {
		input_tokens: number;
		output_tokens: number;
		cache_read_tokens: number;
		cache_write_tokens: number;
		reasoning_tokens: number;
		prompt_tokens: number;
	} | null;
};

/** USD per million tokens: input, output, cache read, cache write (5 min), from Anthropic's API
 *  price list. A model missing here gets no cost rather than a guessed one. */
const PRICES: Record<string, [number, number, number, number]> = {
	"claude-sonnet-5-5": [2, 10, 0.2, 2.5],
	"claude-opus-5-5": [4, 20, 0.2, 5],
	"claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125]
};

const price = (model: string) => PRICES[model.replace(/^anthropic\//, "").replace(/\./g, "-")];

type Row = {
	id: number;
	role: string;
	content: string | null;
	tool_call_id: string | null;
	tool_calls: string | null;
	tool_name: string | null;
	timestamp: number;
};

type Usage = {
	model: string;
	task: string;
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cache_write_tokens: number;
	estimated_cost_usd: number;
};

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

const SCREENSHOT_PATH = /"screenshot_path":\s*"([^"]+?\.(?:png|jpe?g|webp|gif))"/gi;

function images(text: string, paths: RegExp = /MEDIA:(\S+?\.(?:png|jpe?g|webp|gif))/gi): Image[] {
	const found: Image[] = [];
	for (const [, path] of text.matchAll(paths)) {
		if (!existsSync(path) || statSync(path).size > 8 * 1024 * 1024) continue;
		const ext = extname(path).slice(1).toLowerCase();
		found.push({
			mediaType: `image/${ext === "jpg" ? "jpeg" : ext}`,
			data: readFileSync(path).toString("base64")
		});
	}
	return found;
}

/** The calls an assistant message made, unwrapped from `tool_call` into the MCP tools reached. */
function calls(row: Row): { id: string; tool: string; input: unknown }[] {
	const list = JSON.parse(row.tool_calls ?? "[]") as {
		id: string;
		function: { name: string; arguments: string };
	}[];
	return list.flatMap((c) => {
		let input: any;
		try {
			input = JSON.parse(c.function.arguments || "{}");
		} catch {
			input = c.function.arguments;
		}
		if (c.function.name === "tool_call" && Array.isArray(input?.calls))
			return input.calls.map((inner: { name?: string; arguments: unknown }) => ({
				id: c.id,
				// The model can leave the name out; the result row then names the tool, or nothing did.
				tool: inner.name ?? "tool_call",
				input: inner.arguments ?? {}
			}));
		return [{ id: c.id, tool: c.function.name, input }];
	});
}

/** The session `sessionId` of the profile whose database is `db`, with the per-call usage the
 *  hook wrote to `callsPath`. */
export function parseHermesSession(db: string, sessionId: string, callsPath: string): Session {
	const sql = new DatabaseSync(db, { readOnly: true });
	const meta = sql
		.prepare("SELECT title, started_at, ended_at FROM sessions WHERE id = ?")
		.get(sessionId) as { title: string | null; started_at: number; ended_at: number | null };
	const rows = sql
		.prepare(
			"SELECT id, role, content, tool_call_id, tool_calls, tool_name, timestamp FROM messages " +
				"WHERE session_id = ? AND (active = 1 OR compacted = 1) ORDER BY id"
		)
		.all(sessionId) as Row[];
	const usage = sql
		.prepare(
			"SELECT model, task, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, " +
				"estimated_cost_usd FROM session_model_usage WHERE session_id = ?"
		)
		.all(sessionId) as Usage[];
	sql.close();

	const ask = rows.find((r) => r.role === "user")?.content ?? "";
	const steps: Step[] = [];
	const pending = new Map<string, ToolStep[]>();
	/** The last step that names each `browser_exec` screenshot file. */
	const lastShot = new Map<string, ToolStep>();
	for (const row of rows) {
		if (row.role === "assistant") {
			if (row.content?.trim()) steps.push({ kind: "text", at: iso(row.timestamp), text: row.content });
			for (const c of calls(row)) {
				const step: ToolStep = {
					kind: "tool",
					at: iso(row.timestamp),
					end: null,
					tool: c.tool,
					input: c.input,
					error: false,
					result: "",
					images: []
				};
				steps.push(step);
				pending.set(c.id, [...(pending.get(c.id) ?? []), step]);
			}
		} else if (row.role === "tool" && row.tool_call_id) {
			// A `tool_call` wrapper running several MCP calls answers each with a row of its own,
			// in the order of the calls.
			const step = pending.get(row.tool_call_id)?.shift();
			if (!step) continue;
			const text = row.content ?? "";
			step.end = iso(row.timestamp);
			step.result = text;
			step.images = images(text);
			for (const [, path] of text.matchAll(SCREENSHOT_PATH)) lastShot.set(path, step);
			step.error = /"is_error":\s*true|^Error:|"error":\s*"(?!null)/m.test(text.slice(0, 2000));
			if (row.tool_name && step.tool === "tool_call") step.tool = row.tool_name;
		}
	}

	for (const [path, step] of lastShot)
		step.images.push(...images(`"screenshot_path": "${path}"`, SCREENSHOT_PATH));

	const callRows = existsSync(callsPath)
		? readFileSync(callsPath, "utf8")
				.split("\n")
				.filter(Boolean)
				.map((l) => JSON.parse(l) as Call)
				.filter((c) => c.session_id === sessionId && c.usage)
				.sort((a, b) => a.api_call_count - b.api_call_count)
		: [];
	const prompt = (c: Call) =>
		c.usage!.input_tokens + c.usage!.cache_read_tokens + c.usage!.cache_write_tokens;
	const last = callRows.at(-1);

	// Totals from the database cover every call the session billed, auxiliary ones (titling,
	// compression) included; the hook sees the main loop only.
	const tokens: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	const byModel: Record<string, number> = {};
	let priced = true;
	for (const u of usage) {
		tokens.input += u.input_tokens;
		tokens.output += u.output_tokens;
		tokens.cacheRead += u.cache_read_tokens;
		tokens.cacheWrite += u.cache_write_tokens;
		const p = price(u.model);
		if (!p) {
			priced = false;
			continue;
		}
		const usd =
			(u.input_tokens * p[0] +
				u.output_tokens * p[1] +
				u.cache_read_tokens * p[2] +
				u.cache_write_tokens * p[3]) /
			1e6;
		byModel[u.model] = (byModel[u.model] ?? 0) + usd;
	}
	const start = rows[0]?.timestamp ?? meta?.started_at ?? 0;
	const endAt = rows.at(-1)?.timestamp ?? meta?.ended_at ?? start;
	const answer = [...rows].reverse().find((r) => r.role === "assistant" && r.content?.trim())?.content ?? "";

	return {
		ask,
		start: iso(start),
		durationMs: Math.round((endAt - start) * 1000),
		steps,
		id: sessionId,
		path: db,
		title: meta?.title ?? null,
		answer,
		end: iso(endAt),
		models: [...new Set([...usage.map((u) => u.model), ...callRows.map((c) => c.model)])],
		turns: callRows.length,
		tokens,
		context: {
			start: callRows[0] ? prompt(callRows[0]) : 0,
			peak: Math.max(0, ...callRows.map(prompt)),
			end: last ? prompt(last) + last.usage!.output_tokens : 0
		},
		cost: priced
			? { usd: Object.values(byModel).reduce((a, b) => a + b, 0), byModel, since: iso(start) }
			: null
	};
}

/** What Hermes itself estimated the session cost, to set against ours. */
export function hermesEstimate(db: string, sessionId: string): number {
	const sql = new DatabaseSync(db, { readOnly: true });
	const row = sql
		.prepare("SELECT SUM(estimated_cost_usd) AS usd FROM session_model_usage WHERE session_id = ?")
		.get(sessionId) as { usd: number | null };
	sql.close();
	return row?.usd ?? 0;
}
