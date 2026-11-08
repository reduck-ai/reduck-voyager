/**
 * What the replay page reads, under `data/`: `tasks.json`, every task that has runs with its
 * trials, and `<folder>/<task>.<arm>.json`, one run with its session. Each file is exactly a type
 * of `replay/run.ts`, so nothing the page does not show leaves this machine.
 *
 * A run is read at a stage (`list`, `load`): raw from `runs/` and its transcript, draft from
 * `exports/`, published from `replay/public/data/`. `pnpm replay` serves any stage live
 * (vite.config.ts), the MCP reads any stage (mcp.ts), and the site is built from the published
 * files alone. `pnpm export` drafts a run and `--approve` publishes it (export.ts).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Run, RunWithSession, Stage, TaskTrials } from "./replay/run.ts";
import { audit, offTool } from "./audit.ts";
import { parseSession, type Session } from "./session.ts";
import type { Task } from "./task.ts";

const RUNS = join(import.meta.dirname, "runs");
/** A run's export while it is reviewed and redacted (git-ignored), then, once approved, where the
 *  site is built from. `<id>.json` in both. */
export const DRAFTS = join(import.meta.dirname, "exports");
export const PUBLISHED = join(import.meta.dirname, "replay/public/data");

/** A run as recorded, with where its transcript is: what the transcript says is read from it. */
export type Recorded = Omit<Run, "context"> & { transcript: string };

/** Every recorded run that still has its transcript. A run's id is its folder under `runs/`,
 *  `<folder>/<task>.<arm>`, the same run.ts writes files to. */
export function runs(): Recorded[] {
	if (!existsSync(RUNS)) return [];
	return readdirSync(RUNS).flatMap((folder) => {
		const file = join(RUNS, folder, "results.jsonl");
		if (!existsSync(file)) return [];
		return readFileSync(file, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line))
			.filter((row) => row.session && existsSync(row.session))
			.map((row) => ({
				id: `${folder}/${row.task}.${row.arm}`,
				task: row.task,
				arm: row.arm,
				verdict: row.verdict,
				outcome: row.outcome,
				wallMs: row.wallMs,
				costUsd: row.costUsd,
				answer: row.answer,
				...(row.harness === "hermes" ? { harness: "hermes" as const } : {}),
				...(row.reduckConcurrency ? { reduckConcurrency: row.reduckConcurrency } : {}),
				transcript: row.session
			}));
	});
}

/** Where a run's file is at a stage that has files. */
export const stageFile = (id: string, stage: Exclude<Stage, "raw">) =>
	join(stage === "draft" ? DRAFTS : PUBLISHED, `${id}.json`);

/** Every run at a stage, without its session. */
export function list(stage: Stage): Run[] {
	if (stage === "raw") return runs().map((r) => withoutSession(withSession(r)));
	const dir = stage === "draft" ? DRAFTS : PUBLISHED;
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { recursive: true, encoding: "utf8" })
		.filter((f) => f.endsWith(".json") && f !== "tasks.json")
		.map((f) => withoutSession(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

/** One run at a stage, whole; null when it has not reached that stage. */
export function load(id: string, stage: Stage): RunWithSession | null {
	if (stage === "raw") {
		const run = runs().find((r) => r.id === id);
		return run ? withSession(run) : null;
	}
	const path = stageFile(id, stage);
	return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

const withoutSession = ({ session: _, ...run }: RunWithSession): Run => run;

/** The tasks that have runs, each with its trials newest first (Reduck MCP first within one);
 *  pinned tasks first, then the task run most recently first. A run whose task file is gone is
 *  left out: there is nothing to title it with. */
export function index(runs: Run[], tasks: Task[]): TaskTrials[] {
	const pinned = new Set(tasks.filter((t) => t.pinned).map((t) => t.id));
	return tasks
		.map(({ id, name, prompt }) => {
			const mine = runs.filter((r) => r.task === id);
			const trials = Object.entries(Object.groupBy(mine, (r) => r.id.split("/")[0]))
				.map(([trial, runs]) => ({
					id: trial,
					runs: runs!.sort((a, b) => b.arm.localeCompare(a.arm))
				}))
				.sort((a, b) => (a.id < b.id ? 1 : -1));
			return { id, name, prompt, trials };
		})
		.filter((t) => t.trials.length)
		.sort(
			(a, b) =>
				Number(pinned.has(b.id)) - Number(pinned.has(a.id)) ||
				(a.trials[0].id < b.trials[0].id ? 1 : -1)
		);
}

/** A Hermes run's transcript is the `session.json` hermes.ts already wrote in this shape (see
 *  hermes-session.ts); a Claude Code run's is its JSONL, parsed here. */
const readSession = (transcript: string): Session =>
	transcript.endsWith(".json")
		? JSON.parse(readFileSync(transcript, "utf8"))
		: parseSession(transcript);

export function withSession({ transcript, ...run }: Recorded): RunWithSession {
	const { ask, start, durationMs, steps, models, context } = readSession(transcript);
	const offtool = offTool(run.arm, audit(run.arm, steps));
	return {
		...run,
		context: context.end,
		...(offtool ? { offTool: offtool } : {}),
		session: { ask, start, durationMs, steps, models }
	};
}
