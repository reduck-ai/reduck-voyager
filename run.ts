/**
 * Run each task in `tasks/` once per arm, one run at a time, and record its verdict.
 *
 *   pnpm bench                          # every task, both arms
 *   pnpm bench --task t1 --arm chrome --timeout 10   # minutes per run, default 15
 *   REDUCK_MCP_URL=https://… REDUCK_API_KEY=… pnpm bench --arm reduck
 *   pnpm bench --task t1 --arm chrome --trial 2026-09-28T06-01-13-893Z
 *
 * One call is one trial: its runs go into `runs/<time>/`, and the runs of a task there, one per
 * arm, are what the replay page compares. `--trial <folder>` joins an existing trial instead, so
 * an arm run on its own sits next to the other arm's run; it refuses a task and arm the trial
 * already has.
 *
 * REDUCK_MCP_URL picks the Reduck the runs and the `requires` checks both reach (the CLI reads
 * it too). REDUCK_API_KEY, when set, is used instead of the Reduck CLI's OAuth login.
 *
 * A run is one Claude Code session through the Agent SDK. The arms differ in one sentence of
 * the prompt and in the one browser tool the session gets: Claude in Chrome (`--chrome`), or
 * Reduck as the only MCP server. `--strict-mcp-config` and ENABLE_CLAUDEAI_MCP_SERVERS=false
 * keep the claude.ai connectors (which include Reduck) out of both.
 *
 * Runs are sequential because both arms download into the same ~/Downloads: every file that
 * appears there during a run is moved into the run's folder. The task's check (see task.ts)
 * then judges the run from those files and its session.
 */
import { query, type Options, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	statSync
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { parseSession, projectDir } from "./session.ts";
import { tasks, type Task, type Verdict } from "./task.ts";

type Arm = "reduck" | "chrome";
const ARMS: Record<Arm, string> = {
	reduck: "Use Reduck MCP.",
	chrome: "Use Claude for Chrome MCP."
};

const DOWNLOADS = join(homedir(), "Downloads");
const REDUCK_MCP = process.env.REDUCK_MCP_URL ?? "https://mcp.reduck.ai";

const { values: flags } = parseArgs({
	options: {
		task: { type: "string" },
		arm: { type: "string" },
		timeout: { type: "string", default: "15" },
		trial: { type: "string" }
	}
});
const timeoutMs = Number(flags.timeout) * 60_000;
const all = await tasks();
const out = join(
	import.meta.dirname,
	"runs",
	flags.trial ?? new Date().toISOString().replace(/[:.]/g, "-")
);
if (flags.trial && !existsSync(out)) throw new Error(`no trial ${flags.trial} in runs/`);
mkdirSync(out, { recursive: true });
/** The task and arm pairs the trial already has, when joining one. */
const taken = new Set(
	existsSync(join(out, "results.jsonl"))
		? readFileSync(join(out, "results.jsonl"), "utf8")
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line))
				.filter((row) => !row.skipped)
				.map((row) => `${row.task}.${row.arm}`)
		: []
);

/** Reduck credentials: an API key when set, else the Reduck CLI's OAuth token, refreshed by
 *  `whoami` because it lives one hour. */
function reduckHeaders(): Record<string, string> {
	if (process.env.REDUCK_API_KEY) return { "x-api-key": process.env.REDUCK_API_KEY };
	execFileSync("npx", ["-y", "@reduck-ai/cli@latest", "whoami"], { stdio: "ignore" });
	const config = JSON.parse(readFileSync(join(homedir(), ".config/reduck/config.json"), "utf8"));
	return {
		Authorization: `Bearer ${config.servers[REDUCK_MCP].tokens[REDUCK_MCP].access_token}`
	};
}

function options(arm: Arm, cwd: string, abortController: AbortController): Options {
	return {
		cwd,
		abortController,
		systemPrompt: { type: "preset", preset: "claude_code" },
		settingSources: [],
		permissionMode: "bypassPermissions",
		allowDangerouslySkipPermissions: true,
		// Nobody is there to answer.
		disallowedTools: ["AskUserQuestion"],
		env: { ...process.env, ENABLE_CLAUDEAI_MCP_SERVERS: "false" },
		extraArgs: { "strict-mcp-config": null, [arm === "chrome" ? "chrome" : "no-chrome"]: null },
		mcpServers:
			arm === "reduck"
				? { reduck: { type: "http", url: `${REDUCK_MCP}/mcp`, headers: reduckHeaders() } }
				: {}
	};
}

/** Every file under ~/Downloads, two levels deep: agents make subfolders. */
function downloads(): Set<string> {
	const files = new Set<string>();
	const walk = (dir: string, depth: number) => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, e.name);
			if (e.isFile()) files.add(path);
			else if (e.isDirectory() && depth > 0 && !e.name.endsWith(".app"))
				walk(path, depth - 1);
		}
	};
	walk(DOWNLOADS, 1);
	return files;
}

function folders(): string[] {
	return readdirSync(DOWNLOADS, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => join(DOWNLOADS, e.name));
}

async function run(task: Task, arm: Arm) {
	const name = `${task.id}.${arm}`;
	const dir = join(out, name);
	const files = join(dir, "files");
	mkdirSync(files, { recursive: true });
	// A fresh empty working directory, outside the repo, so the agent starts from nothing.
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), `voyager-${name}-`)));
	const before = downloads();
	const foldersBefore = new Set(folders());
	const start = Date.now();
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), timeoutMs);
	let sessionId = "";
	let result: SDKResultMessage | undefined;
	let failure = "";
	try {
		for await (const m of query({
			prompt: `${ARMS[arm]}\n${task.prompt}`,
			options: options(arm, cwd, abort)
		})) {
			sessionId ||= m.session_id ?? "";
			if (m.type === "result") result = m;
		}
	} catch (e) {
		failure = abort.signal.aborted
			? `timeout after ${flags.timeout} min`
			: `crash: ${e instanceof Error ? e.message : String(e)}`;
	} finally {
		clearTimeout(timer);
	}
	// The session's time only: a check can run scripts of its own, which are no part of the run.
	const wallMs = Date.now() - start;

	// What the run produced: new files in ~/Downloads, and whatever it left in its cwd.
	const produced = [
		...[...downloads()].filter((f) => !before.has(f) && statSync(f).mtimeMs >= start - 1000),
		...readdirSync(cwd, { recursive: true, withFileTypes: true })
			.filter((e) => e.isFile())
			.map((e) => join(e.parentPath, e.name))
	];
	const kept = produced.map((f, i) => {
		const to = join(files, `${i}-${basename(f)}`);
		renameSync(f, to);
		return to;
	});
	// A folder the run made in ~/Downloads would tell the next run where the invoices went, so it
	// moves out too, with whatever is left in it.
	for (const f of folders()) if (!foldersBefore.has(f)) renameSync(f, join(dir, basename(f)));

	const session = sessionId ? join(projectDir(cwd), `${sessionId}.jsonl`) : null;
	const answer = result?.subtype === "success" ? result.result : "";
	let verdict: Verdict | null = null;
	try {
		verdict =
			(await task.check?.({
				answer,
				session: session ? parseSession(session) : null,
				files: kept
			})) ?? null;
	} catch (e) {
		verdict = {
			pass: false,
			detail: `check crashed: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	const row = {
		task: task.id,
		arm,
		mcp: arm === "reduck" ? REDUCK_MCP : undefined,
		verdict,
		outcome: failure || (result?.subtype ?? "no result"),
		wallMs,
		turns: result?.num_turns ?? 0,
		costUsd: result?.total_cost_usd ?? 0,
		usage: result?.usage,
		modelUsage: result?.modelUsage,
		files: kept.map((f) => basename(f)),
		sessionId,
		session,
		answer
	};
	appendFileSync(join(out, "results.jsonl"), JSON.stringify(row) + "\n");
	const judged = verdict
		? `${verdict.pass ? "pass" : "FAIL"} ${verdict.detail ?? ""}`
		: "unchecked";
	console.log(
		`${name.padEnd(22)} ${judged}  ${(row.wallMs / 1000).toFixed(0)}s  ` +
			`${row.turns} turns  $${row.costUsd.toFixed(2)}  ${row.outcome}`
	);
}

// `requires` before every run, not once per task: a run can change what the next one starts
// from (a cart, a sign-in), and both arms must start from the same state.
for (const task of all.filter((t) => !flags.task || t.id === flags.task)) {
	for (const arm of ["reduck", "chrome"] as Arm[]) {
		if (flags.arm && flags.arm !== arm) continue;
		if (taken.has(`${task.id}.${arm}`)) {
			console.log(`${`${task.id}.${arm}`.padEnd(22)} SKIP  trial ${flags.trial} already has it`);
			continue;
		}
		const ready: Verdict = await Promise.resolve(task.requires?.() ?? { pass: true }).catch(
			(e: unknown) => ({ pass: false, detail: e instanceof Error ? e.message : String(e) })
		);
		if (ready.pass) {
			await run(task, arm);
			continue;
		}
		appendFileSync(
			join(out, "results.jsonl"),
			JSON.stringify({ task: task.id, arm, skipped: ready.detail }) + "\n"
		);
		console.log(`${`${task.id}.${arm}`.padEnd(22)} SKIP  ${ready.detail ?? ""}`);
	}
}
console.log(`results: ${join(out, "results.jsonl")}`);
