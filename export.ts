/**
 * Take runs to the public site in two steps, by name, each a run id as `pnpm replay` shows it:
 *
 *   pnpm export <folder>/<task>.<arm> …            # a draft in `exports/` (git-ignored)
 *   pnpm export --approve <folder>/<task>.<arm> …  # moved into `replay/public/data/`
 *   pnpm export --approve                          # only the index and the checks, after
 *                                                  # deleting a published file
 *
 * A trace can hold private data no rule foresees, so a draft is read whole (`read_session` with
 * `stage: "draft"` in mcp.ts) and edited there (`redact_export`) until it is clean. The
 * transcript it came from is never edited, and a published file is never edited either: it is
 * the draft a person approved. `--approve` needs that person's yes; the push that follows is a
 * second one.
 *
 * The checks are a net under that reading, not a substitute for it. A run must belong to a public
 * task (outside `tasks/private/`). Screenshots are dropped: they show the whole browser. What
 * remains is text, scrubbed of what this machine puts in every trace (SCRUB). A line of
 * `tasks/private/deny.txt` (emails, handles, names) or the home directory path, case ignored, is
 * reported in a draft and refused at approval, for every published file, not only the new ones:
 * deny.txt grows. Without that file it does not run.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { index, PUBLISHED, runs, stageFile, withSession } from "./data.ts";
import type { Run, RunWithSession, TaskTrials } from "./replay/run.ts";
import { tasks } from "./task.ts";

const DENY = join(import.meta.dirname, "tasks/private/deny.txt");

if (!existsSync(DENY)) throw new Error(`${DENY} is missing: one private string per line`);
/** What must never be published, each with how a report names it: printing the string itself
 *  would put it in the output of whoever ran this, an agent included. */
const deny = [
	{ text: homedir(), name: "the home directory" },
	...readFileSync(DENY, "utf8")
		.split("\n")
		.map((l, i) => ({ text: l.trim(), name: `deny.txt line ${i + 1}` }))
		.filter((d) => d.text)
].map((d) => ({ ...d, text: d.text.toLowerCase() }));
const denied = (id: string, text: string) => {
	const lower = text.toLowerCase();
	return deny.filter((d) => lower.includes(d.text)).map((d) => `${id}: contains ${d.name}`);
};

/** Rewritten, not refused: Claude Code saves a large tool result under the home directory, in a
 *  folder named after the run's working directory, a temp folder, and the agent reads it back
 *  with Bash; Google's CAPTCHA page prints the visitor's IP, in the browser's language (its
 *  `/sorry/` URL encodes it too).
 *  An email address is masked wherever it appears, even one a stranger made public in a bio. */
const TMP = realpathSync(tmpdir());
const SCRUB: [string | RegExp, string][] = [
	[homedir(), "~"],
	[TMP, "$TMPDIR"],
	[tmpdir(), "$TMPDIR"],
	[TMP.replace(/[^a-zA-Z0-9]/g, "-"), "-TMPDIR"],
	[/(https?:\/\/(?:www\.)?google\.[a-z.]+\/sorry\/)[^\s"\\]*/g, "$1…"],
	// The label is in the browser's language: "IP address:", "Adresse IP :", "IP-Adresse:".
	[/((?:IP[ -]?address|Adresse IP|IP-Adresse|Dirección IP|Indirizzo IP)\s*: ?)[0-9a-f.:]+/gi, "$1…"],
	[/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi, "…@…"]
];
const scrub = (text: string) =>
	SCRUB.reduce((t, [from, to]) => (typeof from === "string" ? t.replaceAll(from, to) : t.replace(from, to)), text);

const { values, positionals: ids } = parseArgs({
	options: { approve: { type: "boolean", default: false } },
	allowPositionals: true
});
const allTasks = await tasks();
const taskOf = new Map(allTasks.map((t) => [t.id, t]));
const write = (path: string, text: string) => {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
};

if (!values.approve) {
	const recorded = runs();
	for (const id of ids) {
		const r = recorded.find((r) => r.id === id);
		if (!r) console.error(`${id}: no such run with a transcript`);
		else if (!taskOf.has(r.task)) console.error(`${id}: no task file has the id ${r.task}`);
		else if (taskOf.get(r.task)!.private) console.error(`${id}: task ${r.task} is private`);
		else if (existsSync(stageFile(id, "published"))) console.error(`${id}: already published`);
		else {
			const run = withSession(r);
			for (const s of run.session.steps) if (s.kind === "tool") s.images = [];
			const text = scrub(JSON.stringify(run));
			write(stageFile(id, "draft"), text);
			const found = denied(id, text);
			console.log(`${id}: draft written${found.length ? `, still to redact:\n  ${found.join("\n  ")}` : ""}`);
		}
	}
	process.exit(0);
}

const published = existsSync(PUBLISHED)
	? readdirSync(PUBLISHED, { recursive: true, encoding: "utf8" })
			.filter((f) => f.endsWith(".json") && f !== "tasks.json")
			.map((f) => f.slice(0, -".json".length))
	: [];
const texts = new Map(published.map((id) => [id, readFileSync(stageFile(id, "published"), "utf8")]));
const problems: string[] = [];
for (const id of ids) {
	if (!existsSync(stageFile(id, "draft"))) problems.push(`${id}: no draft (pnpm export ${id})`);
	else if (texts.has(id)) problems.push(`${id}: already published`);
	else texts.set(id, readFileSync(stageFile(id, "draft"), "utf8"));
}
for (const [id, text] of texts) problems.push(...denied(id, text));
if (problems.length) {
	console.error(`nothing moved:\n${problems.join("\n")}`);
	process.exit(1);
}

for (const id of ids) {
	mkdirSync(dirname(stageFile(id, "published")), { recursive: true });
	renameSync(stageFile(id, "draft"), stageFile(id, "published"));
}
// The index is whatever the folder holds, so deleting a run's file and running this unpublishes it.
const listed: Run[] = [...texts.values()].map((text) => {
	const { session: _, ...run }: RunWithSession = JSON.parse(text);
	return run;
});
// A published task whose file this machine lacks (a private one, kept by whoever ran it) keeps
// its name and prompt from the index already published, so approving here never drops it.
const indexFile = join(PUBLISHED, "tasks.json");
const before: TaskTrials[] = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, "utf8")) : [];
// The index keeps no `pinned`: a task listed above every task this machine has a file for was
// pinned (index() puts pinned tasks first), so it stays first.
const firstKnown = before.findIndex((t) => taskOf.has(t.id));
const known = [
	...allTasks,
	...before
		.filter((t) => !taskOf.has(t.id))
		.map(({ id, name, prompt }) => ({ id, name, prompt, pinned: firstKnown === -1 || before.findIndex((t) => t.id === id) < firstKnown }))
];
write(indexFile, JSON.stringify(index(listed, known)));
console.log(`${ids.length} approved, ${listed.length} published → ${PUBLISHED}`);
