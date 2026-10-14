/**
 * Import recorded Reduck runs of `reduck/chatgpt.com/ask` as runs of the page, verbatim.
 *
 *   pnpm ingest perso.jsonl=signed-in pro.jsonl=signed-out
 *
 * Each file holds one Reduck run record per line, as Reduck stores it: `{id, script, args,
 * device, browser, status, startedAt, finishedAt, result}`. The label after `=` is the arm every
 * run of that file is filed under: what is compared (signed in or out, a device, a country).
 *
 * A run's task is its question, slugged. One trial holds at most one run per task and arm, so
 * the k-th run of a question on an arm, by start time, joins trial k: run each question n times
 * per arm and the page has n trials to compare, each named by the start of its first run.
 * Every file is imported in one call so the trials of all arms line up.
 *
 * A record is kept as is, `runs/<trial>/<task>.<arm>/record.json`, and read by ask.ts; its row
 * in `results.jsonl` names it as a bench row names its transcript. A run already imported (its
 * Reduck id is on a row) or one with no result is left out, and said so.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseAsk } from "./ask.ts";

const RUNS = join(import.meta.dirname, "runs");
const SCRIPT = "reduck/chatgpt.com/ask";

const pairs = process.argv.slice(2).map((a) => a.split("="));
if (!pairs.length || pairs.some(([file, arm]) => !file || !arm))
	throw new Error("usage: pnpm ingest <file.jsonl>=<arm> …");

const done = new Set(
	existsSync(RUNS)
		? readdirSync(RUNS).flatMap((folder) => {
				const file = join(RUNS, folder, "results.jsonl");
				return existsSync(file)
					? readFileSync(file, "utf8")
							.split("\n")
							.filter(Boolean)
							.map((line) => JSON.parse(line).reduckRun)
							.filter(Boolean)
					: [];
			})
		: []
);

const slug = (text: string) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 60)
		.replace(/-$/, "");

type Rec = { id: string; script: string; args: { question: string }; status: string; startedAt: string; result: unknown };
const records = pairs.flatMap(([file, arm]) =>
	readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => ({ arm, record: JSON.parse(line) as Rec }))
		.filter(({ record }) => {
			const why =
				record.script !== SCRIPT
					? `not ${SCRIPT}`
					: !record.result
						? `no result (${record.status})`
						: done.has(record.id)
							? "already imported"
							: null;
			if (why) console.log(`${record.id}  SKIP  ${why}`);
			return !why;
		})
);

// The k-th run of a task on an arm goes to trial k.
const nth = new Map<string, number>();
const placed = records
	.sort((a, b) => a.record.startedAt.localeCompare(b.record.startedAt))
	.map((r) => {
		const task = slug(r.record.args.question);
		const key = `${task}.${r.arm}`;
		const k = (nth.get(key) ?? 0) + 1;
		nth.set(key, k);
		return { ...r, task, k };
	});
const trialOf = new Map<number, string>();
for (const p of placed)
	if (!trialOf.has(p.k)) trialOf.set(p.k, p.record.startedAt.replace(/[:.]/g, "-"));

for (const { arm, record, task, k } of placed) {
	const trial = trialOf.get(k)!;
	const dir = join(RUNS, trial, `${task}.${arm}`);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "record.json");
	writeFileSync(path, JSON.stringify(record, null, 2));
	const { answer, wallMs } = parseAsk(path);
	const row = {
		task,
		arm,
		prompt: record.args.question,
		verdict: null,
		outcome: record.status,
		wallMs,
		costUsd: null,
		reduckRun: record.id,
		record: path,
		answer
	};
	appendFileSync(join(RUNS, trial, "results.jsonl"), JSON.stringify(row) + "\n");
	console.log(`${record.id}  → ${trial}/${task}.${arm}`);
}
console.log(`${placed.length} imported into ${trialOf.size} trial(s)`);
