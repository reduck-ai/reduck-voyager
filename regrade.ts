/**
 * Run a task's check again on a recorded run, for a check that failed for a reason of its own
 * (the device that runs its scripts did not answer), and write the new verdict into the row.
 * Temporary, next to hermes.ts: grade.ts reads Claude Code transcripts only.
 *
 *   node regrade.ts <trial> <task> <arm>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tasks } from "./task.ts";

const [trial, taskId, arm] = process.argv.slice(2);
const file = join(import.meta.dirname, "runs", trial, "results.jsonl");
const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const row = rows.find((r) => r.task === taskId && r.arm === arm);
const task = (await tasks()).find((t) => t.id === taskId);
if (!row || !task?.check) throw new Error(`no ${taskId}.${arm} in ${trial}, or no check`);
const session = JSON.parse(readFileSync(join(import.meta.dirname, "runs", trial, `${taskId}.${arm}`, "session.json"), "utf8"));
row.verdict = await task.check({ answer: row.answer, session, files: [] });
writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`${taskId}.${arm}`, JSON.stringify(row.verdict));
