/**
 * Set a run's verdict in its row of `runs/<folder>/results.jsonl`.
 *
 *   pnpm grade <folder>/<task>.<arm>                     # run the task's check again
 *   pnpm grade <folder>/<task>.<arm> pass|fail "<why>"   # a person's verdict
 *
 * Without a verdict, the task's check judges the run from what the run left: its answer, its
 * transcript, and the files kept in `<task>.<arm>/files/`. That grades runs recorded before
 * their task had a check. With one, it is a person's: for a task no code can grade (open
 * research), or to overrule a check.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseSession } from "./session.ts";
import { tasks, type Verdict } from "./task.ts";

const [id = "", grade, detail] = process.argv.slice(2);
const [, folder, taskId, arm] = id.match(/^([^/]+)\/(.+)\.(reduck|chrome|browser)$/) ?? [];
const byPerson = grade !== undefined;
if (!folder || (byPerson && ((grade !== "pass" && grade !== "fail") || !detail)))
	throw new Error('usage: pnpm grade <folder>/<task>.<arm> [pass|fail "<why>"]');

const file = join(import.meta.dirname, "runs", folder, "results.jsonl");
const rows = readFileSync(file, "utf8")
	.split("\n")
	.filter(Boolean)
	.map((line) => JSON.parse(line));
const row = rows.find((r) => r.task === taskId && r.arm === arm && !r.skipped);
if (!row) throw new Error(`no run ${id}`);

let verdict: Verdict;
if (byPerson) verdict = { pass: grade === "pass", detail, by: "person" };
else {
	const task = (await tasks()).find((t) => t.id === taskId);
	if (!task?.check) throw new Error(`task ${taskId} has no check: grade it as a person`);
	const kept = join(import.meta.dirname, "runs", folder, `${taskId}.${arm}`, "files");
	verdict = await task.check({
		answer: row.answer ?? "",
		session: row.session ? parseSession(row.session) : null,
		files: (row.files ?? []).map((f: string) => join(kept, f))
	});
}
row.verdict = verdict;
writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(
	`${taskId}.${arm}: ${verdict.pass ? "pass" : "fail"} (by ${verdict.by ?? "check"})${verdict.detail ? `: ${verdict.detail}` : ""}`
);
