/**
 * Stdio MCP server over `session.ts`, so an agent can read Claude Code sessions directly, and
 * take bench runs to the public site: list them, read one whole at each stage (its transcript,
 * its draft export, its published file), draft it, and redact the draft (export.ts says why).
 * Approving a draft is a person's yes, so it stays `pnpm export --approve`.
 *
 *   claude mcp add -s user claude-sessions-parser -- node <path>/reduck-voyager/mcp.ts
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { load, runs, stageFile, withSession } from "./data.ts";
import { listSessions, parseSession, projectDir, type Step } from "./session.ts";
import { tasks } from "./task.ts";

const server = new McpServer({ name: "claude-sessions-parser", version: "0.2.0" });
const json = (value: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
});
const cwd = z
	.string()
	.describe(
		"Working directory the sessions ran in. Default: the directory this server was started in."
	)
	.optional();
const id = z
	.string()
	.describe(
		"Session id (the .jsonl file name), an absolute path to a .jsonl transcript, or a bench run id `<folder>/<task>.<arm>` from list_runs."
	);
const stage = z
	.enum(["raw", "draft", "published"])
	.default("raw")
	.describe(
		"For a bench run id. raw: its transcript, never edited. draft: its export under review (export_run, redact_export). published: the approved file the site shows, never edited."
	);
const RESULT_CHARS = 500;

/** A session to read: parsed from its transcript, or a run's export, whose session and run
 *  fields are laid flat so both read the same. */
function open(id: string, dir: string, at: z.infer<typeof stage>): { id: string; steps: Step[] } {
	if (at !== "raw") {
		const found = load(id, at);
		if (!found) throw new Error(`no ${at} for ${id}`);
		const { session, ...run } = found;
		return { ...run, ...session };
	}
	const run = runs().find((r) => r.id === id);
	// An imported run has no transcript: its chat is read from its record.
	if (run?.record) {
		const { session, ...rest } = withSession(run);
		return { ...rest, ...session };
	}
	return parseSession(run?.transcript ?? (id.startsWith("/") ? id : join(projectDir(dir), `${id}.jsonl`)));
}

server.registerTool(
	"list_sessions",
	{
		description:
			"List the Claude Code sessions of a working directory, newest first: id, time, first ask, step count, what it cost in USD (null when the transcript records none). Bench runs each ran in a temp directory of their own: list them with list_runs.",
		inputSchema: { cwd, limit: z.number().int().positive().default(20) }
	},
	async ({ cwd: dir = process.cwd(), limit }) =>
		json(
			listSessions(dir)
				.slice(0, limit)
				.map(({ path, modified }) => {
					const s = parseSession(path);
					return {
						id: s.id,
						modified,
						title: s.title,
						ask: s.ask.slice(0, 200),
						steps: s.steps.length,
						durationMs: s.durationMs,
						costUsd: s.cost?.usd ?? null
					};
				})
		)
);

server.registerTool(
	"list_runs",
	{
		description:
			"Every bench run that has its transcript, newest first: its id (`<folder>/<task>.<arm>`), task, arm, verdict, its task's visibility (public: can be exported; private: under tasks/private/, never exported; gone: no task file has that id any more), and its stage: raw, draft (exported, under review) or published.",
		inputSchema: {}
	},
	async () => {
		const known = new Map((await tasks()).map((t) => [t.id, t.private ? "private" : "public"]));
		return json(
			runs()
				.sort((a, b) => (a.id < b.id ? 1 : -1))
				.map((r) => ({
					id: r.id,
					task: r.task,
					arm: r.arm,
					verdict: r.verdict,
					visibility: known.get(r.task) ?? "gone",
					stage: existsSync(stageFile(r.id, "published"))
						? "published"
						: existsSync(stageFile(r.id, "draft"))
							? "draft"
							: "raw"
				}))
		);
	}
);

server.registerTool(
	"read_session",
	{
		description:
			"Parse one Claude Code session: ask, final answer, duration, models, turns, tokens, the cost Claude Code recorded (total and per model, side models included; null when the transcript records none, as for a subagent's), then every step in order — what the assistant said, and each tool call whole (input, error, its full result, when it started and ended) followed by the images it returned (screenshots). For a bench run, `stage` reads its draft or published export instead: exactly what goes public. full: false gives an outline: each result cut to its first 500 characters and images counted, not shown. A bench run is usually too large to read whole in one call: take the outline, then read_step the steps in batches.",
		inputSchema: {
			id,
			cwd,
			stage,
			full: z
				.boolean()
				.default(true)
				.describe("false: an outline, results cut to 500 characters and images counted.")
		}
	},
	async ({ id, cwd: dir = process.cwd(), stage: at, full }) => {
		const s = open(id, dir, at);
		if (full) {
			const { steps, ...rest } = s;
			return {
				content: [
					{ type: "text" as const, text: JSON.stringify(rest, null, 2) },
					...steps.flatMap((_, i) => inFull(s, i))
				]
			};
		}
		return json({
			...s,
			steps: s.steps.map((step, index) =>
				step.kind === "text"
					? { index, ...step }
					: {
							index,
							...step,
							result: step.result.slice(0, RESULT_CHARS),
							images: step.images.length
						}
			)
		});
	}
);

server.registerTool(
	"read_step",
	{
		description:
			"Steps of a session in full, in the order asked: the text each said, or a tool call with its input, its whole result text, and the images it returned (screenshots), shown as images right after it. Pass several indices to read them in one call.",
		inputSchema: {
			id,
			index: z
				.union([z.number().int().min(0), z.array(z.number().int().min(0)).min(1)])
				.describe("A step's index, or a list of them, from read_session."),
			cwd,
			stage
		}
	},
	async ({ id, index, cwd: dir = process.cwd(), stage: at }) => {
		const s = open(id, dir, at);
		return { content: [index].flat().flatMap((i) => inFull(s, i)) };
	}
);

server.registerTool(
	"export_run",
	{
		description:
			"Draft bench runs for the public site (`pnpm export`): scrubbed, screenshots dropped, written to exports/ for review. Reports what deny.txt still finds in each, by line number. Read a draft with read_session stage: \"draft\".",
		inputSchema: { ids: z.array(z.string()).min(1).describe("Run ids from list_runs.") }
	},
	async ({ ids }) => {
		const { stdout, stderr } = await promisify(execFile)(
			"node",
			[join(import.meta.dirname, "export.ts"), ...ids],
			{ cwd: import.meta.dirname }
		);
		return { content: [{ type: "text" as const, text: `${stdout}${stderr}` }] };
	}
);

server.registerTool(
	"redact_export",
	{
		description:
			"Replace every occurrence of a string in a run's draft, in every text it holds (answer, steps, results), and return how many were replaced. Only a draft: a transcript and a published file are never edited. Read the draft again to confirm.",
		inputSchema: {
			id: z.string().describe("A run id whose stage is draft."),
			find: z.string().min(1).describe("The exact text, as read_session shows it."),
			replace: z.string().default("…")
		}
	},
	async ({ id, find, replace }) => {
		const path = stageFile(id, "draft");
		if (!existsSync(path)) throw new Error(`no draft for ${id}: export_run it first`);
		let count = 0;
		const walk = (v: unknown): unknown => {
			if (typeof v === "string") {
				count += v.split(find).length - 1;
				return v.replaceAll(find, replace);
			}
			if (Array.isArray(v)) return v.map(walk);
			if (v && typeof v === "object")
				return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
			return v;
		};
		writeFileSync(path, JSON.stringify(walk(JSON.parse(readFileSync(path, "utf8")))));
		return json({ id, replaced: count });
	}
);

/** One step whole, as MCP content: its JSON, then each image it returned. */
function inFull(session: { id: string; steps: Step[] }, i: number) {
	const step = session.steps[i];
	if (!step) throw new Error(`no step ${i} in session ${session.id}`);
	const { images, ...rest } = step.kind === "tool" ? step : { ...step, images: [] };
	return [
		{ type: "text" as const, text: JSON.stringify({ index: i, ...rest }, null, 2) },
		...images.map((img) => ({
			type: "image" as const,
			data: img.data,
			mimeType: img.mediaType
		}))
	];
}

await server.connect(new StdioServerTransport());
