/**
 * Temporary CLI: the same benchmark as `run.ts`, on the Hermes Agent harness instead of Claude
 * Code. Each task runs once per arm, one run at a time, with the arm's one browser MCP.
 *
 *   node hermes.ts                                   # every task, both arms
 *   node hermes.ts --task reddit-seo-post --arm reduck --timeout 10
 *   node hermes.ts --task reddit-seo-post --arm chrome --trial hermes-2026-11-06T…
 *   node hermes.ts --prompt "Open example.com and give its title" --arm chrome   # a smoke run
 *
 * Trials go to `runs/hermes-<time>/`, apart from Claude Code's, with the same `results.jsonl`
 * rows plus `harness: "hermes"`, the model, and Hermes' own cost estimate.
 *
 * Setup it expects (done once, by hand):
 * - Hermes installed (`hermes` on PATH), and two profiles made with
 *   `hermes profile create voyagerreduck --no-skills --no-alias` (and `voyagerchrome`), whose
 *   `.env` holds ANTHROPIC_API_KEY (here a symlink to ~/.hermes/.env).
 * - The Reduck CLI logged in, or REDUCK_API_KEY, as for `run.ts`.
 * - For the chrome arm, Claude Code installed: `claude --claude-in-chrome-mcp` is the same
 *   stdio server Claude Code runs for `--chrome`, so both harnesses get the same 20 tools.
 *
 * How a run is kept fair to the Claude Code one:
 * - Same prompt, prefixed with the same arm sentence; a fresh empty working directory.
 * - One browser tool: the profile's config holds that arm's MCP server only, and `-t` enables
 *   Hermes' terminal, file and todo tools plus that server. Hermes' own browser, web search,
 *   vision, memory, skills, delegation and clarify toolsets stay off (Claude Code's arms keep
 *   Bash/Read/Write; its WebSearch/WebFetch were never used in a published run).
 * - `--ignore-rules` leaves out SOUL.md, AGENTS.md and memory, as `settingSources: []` does.
 * - Hermes runs the agent in a host gateway daemon that `chat` starts, that serves every profile
 *   and that outlives it. It is stopped before and after each run, so each run starts a new one that
 *   reads the arm's config and opens its MCP server afresh, as a Claude Code session does.
 */
import { execFileSync, spawn } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	realpathSync,
	renameSync,
	statSync,
	writeFileSync
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { fault } from "./faults.ts";
import { hermesEstimate, parseHermesSession } from "./hermes-session.ts";
import { tasks, type Task, type Verdict } from "./task.ts";

type Arm = "reduck" | "chrome";
const ARMS: Record<Arm, string> = {
	reduck: "Use Reduck MCP.",
	chrome: "Use Claude for Chrome MCP."
};
const PROFILES: Record<Arm, string> = { reduck: "voyagerreduck", chrome: "voyagerchrome" };
const MODEL = process.env.HERMES_MODEL ?? "claude-sonnet-5-5";
const TOOLSETS = ["terminal", "file", "todo"];

const DOWNLOADS = join(homedir(), "Downloads");
const REDUCK_MCP = process.env.REDUCK_MCP_URL ?? "https://mcp.reduck.ai";

const { values: flags } = parseArgs({
	options: {
		task: { type: "string" },
		arm: { type: "string" },
		timeout: { type: "string", default: "15" },
		trial: { type: "string" },
		prompt: { type: "string" }
	}
});
const timeoutMs = Number(flags.timeout) * 60_000;
if (flags.trial && !flags.trial.startsWith("hermes-"))
	throw new Error("a Hermes trial's folder starts with hermes-");
const all: Task[] = flags.prompt
	? [{ id: "smoke", name: "Smoke run", prompt: flags.prompt }]
	: await tasks();
const RUNS_DIR = join(import.meta.dirname, "runs");
const out = join(
	RUNS_DIR,
	flags.trial ?? `hermes-${new Date().toISOString().replace(/[:.]/g, "-")}`
);
if (flags.trial && !existsSync(out)) throw new Error(`no trial ${flags.trial} in runs/`);
mkdirSync(out, { recursive: true });
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

const profileHome = (arm: Arm) => join(homedir(), ".hermes", "profiles", PROFILES[arm]);

/** Reduck credentials, as in run.ts: an API key when set, else the Reduck CLI's OAuth token,
 *  refreshed by `whoami` because it lives one hour. */
function reduckHeaders(): Record<string, string> {
	if (process.env.REDUCK_API_KEY) return { "x-api-key": process.env.REDUCK_API_KEY };
	execFileSync("npx", ["-y", "@reduck-ai/cli@latest", "whoami"], { stdio: "ignore" });
	const config = JSON.parse(readFileSync(join(homedir(), ".config/reduck/config.json"), "utf8"));
	return {
		Authorization: `Bearer ${config.servers[REDUCK_MCP].tokens[REDUCK_MCP].access_token}`
	};
}

/** The arm's profile config: the model, its one MCP server, nothing borrowed from other
 *  logins, and the hook that records each API call's usage into the run's folder. JSON is
 *  YAML, so Hermes reads it as is. */
function writeConfig(arm: Arm, calls: string) {
	const mcp =
		arm === "reduck"
			? { reduck: { url: `${REDUCK_MCP}/mcp`, headers: reduckHeaders() } }
			: { chrome: { command: "claude", args: ["--claude-in-chrome-mcp"] } };
	const hook = `python3 -I ${join(import.meta.dirname, "hermes-hook.py")} ${calls}`;
	const config = {
		_config_version: 52,
		model: { default: MODEL, provider: "anthropic" },
		// Without this Hermes may borrow Claude Code's own login instead of the API key.
		auth: { adopt_external_logins: false },
		telemetry: { shared_metrics: { enabled: false, send: false } },
		updates: { check: false },
		memory: { memory_enabled: false, user_profile_enabled: false },
		// The gateway refuses `--run-budget` on the command line.
		agent: { run_budget_seconds: Math.round(timeoutMs / 1000) },
		hooks: { post_api_request: [{ command: hook, timeout: 10 }] },
		hooks_auto_accept: true,
		mcp_servers: mcp
	};
	writeFileSync(join(profileHome(arm), "config.yaml"), JSON.stringify(config, null, 1), {
		mode: 0o600
	});
}

/** Stop the host gateway, which serves every profile (`hermes -p <profile> gateway stop` would
 *  only park the profile, and a parked profile refuses the next `chat`). A marker a park left
 *  is removed for the same reason. */
function stopGateway() {
	try {
		execFileSync("hermes", ["gateway", "stop"], { stdio: "ignore", timeout: 60_000 });
	} catch {
		// Nothing was running.
	}
	for (const home of [join(homedir(), ".hermes"), ...(["reduck", "chrome"] as Arm[]).map(profileHome)])
		rmSync(join(home, "gateway.parked"), { force: true });
}

function downloads(): Set<string> {
	const files = new Set<string>();
	const walk = (dir: string, depth: number) => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, e.name);
			if (e.isFile()) files.add(path);
			else if (e.isDirectory() && depth > 0 && !e.name.endsWith(".app")) walk(path, depth - 1);
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

type Result = {
	type: "result";
	session_id: string;
	exit_code: number;
	text: string;
	error?: string;
};

/** One `hermes chat` in stream-json mode; resolves with its terminal `result` event, if any. */
function chat(arm: Arm, prompt: string, cwd: string, events: string, stderr: string) {
	const args = [
		"-p", PROFILES[arm], "chat",
		"-q", prompt,
		"--format", "stream-json",
		"--yolo",
		"--ignore-rules",
		"--accept-hooks",
		"--source", "tool",
		"-m", MODEL,
		"--provider", "anthropic",
		"-t", [...TOOLSETS, `mcp-${arm}`].join(",")
	];
	return new Promise<{ result: Result | null; timedOut: boolean; code: number | null }>((resolve) => {
		const child = spawn("hermes", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let result: Result | null = null;
		let buffer = "";
		child.stdout.on("data", (chunk: Buffer) => {
			appendFileSync(events, chunk);
			buffer += chunk.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				try {
					const event = JSON.parse(line);
					if (event.type === "result") result = event;
				} catch {
					// Not an event.
				}
			}
		});
		child.stderr.on("data", (chunk: Buffer) => appendFileSync(stderr, chunk));
		let timedOut = false;
		// agent.run_budget_seconds asks Hermes to stop itself; this is the backstop if it does not.
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
		}, timeoutMs + 60_000);
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ result, timedOut, code });
		});
	});
}

async function run(task: Task, arm: Arm) {
	const name = `${task.id}.${arm}`;
	const dir = join(out, name);
	const files = join(dir, "files");
	mkdirSync(files, { recursive: true });
	const calls = join(dir, "calls.jsonl");
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), `voyager-hermes-${name}-`)));

	stopGateway();
	writeConfig(arm, calls);
	const before = downloads();
	const foldersBefore = new Set(folders());
	const start = Date.now();
	const { result, timedOut, code } = await chat(
		arm,
		`${ARMS[arm]}\n${task.prompt}`,
		cwd,
		join(dir, "events.jsonl"),
		join(dir, "stderr.txt")
	);
	const wallMs = Date.now() - start;
	stopGateway();

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
	for (const f of folders()) if (!foldersBefore.has(f)) renameSync(f, join(dir, basename(f)));

	const db = join(profileHome(arm), "state.db");
	const sessionId = result?.session_id ?? "";
	let session = null;
	try {
		session = sessionId ? parseHermesSession(db, sessionId, calls) : null;
	} catch (e) {
		console.error(`${name}: could not read session ${sessionId}: ${e}`);
	}
	if (session) writeFileSync(join(dir, "session.json"), JSON.stringify(session));
	const answer = result?.text || session?.answer || "";
	const outcome = timedOut
		? `timeout after ${flags.timeout} min`
		: result
			? result.exit_code === 0
				? "success"
				: `error: ${result.error ?? `exit ${result.exit_code}`}`
			: `no result (exit ${code})`;

	let verdict: Verdict | null = null;
	// VOYAGER_GRADE_LATER=1 records the run ungraded, for a check that needs the paired browser
	// while it is down; `node regrade.ts <trial> <task> <arm>` grades it once it answers.
	if (!process.env.VOYAGER_GRADE_LATER) try {
		verdict = (await task.check?.({ answer, session, files: kept })) ?? null;
	} catch (e) {
		verdict = { pass: false, detail: `check crashed: ${e instanceof Error ? e.message : String(e)}` };
	}
	const row = {
		task: task.id,
		arm,
		harness: "hermes",
		model: MODEL,
		mcp: arm === "reduck" ? REDUCK_MCP : undefined,
		// The paired browser's concurrency budget, as set on reduck.ai: no CLI reads it, so the
		// batch states it.
		reduckConcurrency:
			arm === "reduck" && process.env.VOYAGER_REDUCK_CONCURRENCY
				? Number(process.env.VOYAGER_REDUCK_CONCURRENCY)
				: undefined,
		verdict,
		outcome,
		wallMs,
		turns: session?.turns ?? 0,
		costUsd: session?.cost?.usd ?? 0,
		hermesCostUsd: sessionId ? hermesEstimate(db, sessionId) : 0,
		context: session?.context.end ?? 0,
		usage: session?.tokens,
		files: kept.map((f) => basename(f)),
		sessionId,
		session: session ? join(dir, "session.json") : null,
		answer
	};
	// Only a run that went end to end is the trial's (faults.ts); any other is kept apart, and the
	// trial can run it again.
	const faulty = fault(row, session?.steps ?? []);
	if (faulty) {
		const aside = join(RUNS_DIR, "_faulty", basename(out));
		mkdirSync(aside, { recursive: true });
		// A run set aside before, under the same name, keeps its folder: this one gets the time.
		const to = existsSync(join(aside, name)) ? `${name}-${Date.now()}` : name;
		renameSync(dir, join(aside, to));
		const moved = { ...row, fault: faulty, session: row.session && join(aside, to, "session.json") };
		appendFileSync(join(aside, "results.jsonl"), JSON.stringify(moved) + "\n");
		console.log(`${name.padEnd(28)} FAULTY ${faulty}: kept in runs/_faulty/${basename(out)}, not in the trial`);
		return;
	}
	appendFileSync(join(out, "results.jsonl"), JSON.stringify(row) + "\n");
	const judged = verdict ? `${verdict.pass ? "pass" : "FAIL"} ${verdict.detail ?? ""}` : "unchecked";
	console.log(
		`${name.padEnd(28)} ${judged}  ${(wallMs / 1000).toFixed(0)}s  ${row.turns} turns  ` +
			`$${row.costUsd.toFixed(2)}  ctx ${Math.round(row.context / 1000)}k  ${outcome}`
	);
}

for (const task of all.filter((t) => !flags.task || t.id === flags.task)) {
	for (const arm of ["reduck", "chrome"] as Arm[]) {
		if (flags.arm && flags.arm !== arm) continue;
		if (taken.has(`${task.id}.${arm}`)) {
			console.log(`${`${task.id}.${arm}`.padEnd(28)} SKIP  trial ${flags.trial} already has it`);
			continue;
		}
		const ready: Verdict = await Promise.resolve(task.requires?.() ?? { pass: true }).catch(
			(e: unknown) => ({ pass: false, detail: e instanceof Error ? e.message : String(e) })
		);
		if (ready.pass) {
			await run(task, arm);
			continue;
		}
		appendFileSync(join(out, "results.jsonl"), JSON.stringify({ task: task.id, arm, harness: "hermes", skipped: ready.detail }) + "\n");
		console.log(`${`${task.id}.${arm}`.padEnd(28)} SKIP  ${ready.detail ?? ""}`);
	}
}
console.log(`results: ${join(out, "results.jsonl")}`);
