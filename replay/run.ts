/** What the page reads, and all that is published of a run (see data.ts). */
import type { Task, Verdict } from "../task.ts";
import type { Chat } from "./chat/chat.ts";

export type Run = {
	id: string;
	task: string;
	/** A bench arm (`ARM_NAMES`), or the label an imported run was given (`pnpm ingest`). */
	arm: string;
	/** The question, for a run whose task is no file in `tasks/` (an imported one). */
	prompt?: string;
	verdict: Verdict | null;
	outcome: string;
	wallMs: number;
	/** Null when the run has no such number (an imported script run). */
	costUsd: number | null;
	/** Tokens in the model's context at its last call: what the task cost it to hold. */
	context: number | null;
	answer: string;
};

/** One page a search put in front of the model, or the answer cited. `call` counts the run's
 *  search calls from 1 and `rank` is the page's place in that call's list from 0, as the
 *  assistant's own `ref` numbers it; both null for a citation with no search result behind it.
 *  `queries` are what the call's round typed (a round can span several calls), null when the
 *  page does not show them (ChatGPT signed out). `ref` is the assistant's own id, verbatim. */
export type Page = {
	ref: string | null;
	url: string;
	title: string | null;
	call: number | null;
	rank: number | null;
	type: string | null;
	queries: string[] | null;
	cited: boolean;
};

export type RunWithSession = Run & { session: Chat & { models: string[] }; pages?: Page[] };

/** Two urls of one page compare equal: no fragment, no trailing slash, no `www.`. */
export const pageKey = (url: string) =>
	url.replace(/#.*$/, "").replace(/\/+$/, "").replace(/^(https?:\/\/)www\./, "$1");

export const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/** Where a run is on its way to the site: its transcript as recorded, its scrubbed draft under
 *  review, or the approved file the site shows. The same shape at every stage (data.ts). */
export type Stage = "raw" | "draft" | "published";

/** The runs of one task from one `pnpm bench` call, at most one per arm: what the page
 *  compares. Its id is the call's folder, which every run id starts with. */
export type Trial = { id: string; runs: Run[] };

/** A task and its trials, newest first: `data/tasks.json` is a list of these. */
export type TaskTrials = Pick<Task, "id" | "name" | "prompt"> & { trials: Trial[] };

export const ARM_NAMES: Record<string, string> = {
	reduck: "Claude with Reduck MCP",
	chrome: "Claude with Chrome MCP"
};
export const armName = (arm: string) => ARM_NAMES[arm] ?? arm;

/** The site whose pages a list of search results highlights: this benchmark is Reduck's. */
export const OURS = "reduck.ai";

export const kTokens = (n: number | null) => (n === null ? "–" : `${Math.round(n / 1000)}k`);
export const usd = (n: number | null) => (n === null ? "–" : `$${n.toFixed(2)}`);

export const verdictLabel = (run: Run) =>
	run.verdict ? (run.verdict.pass ? "✓ Passed" : "✗ Failed") : "Not graded";

const GRADERS: Record<NonNullable<Verdict["by"]>, string> = {
	check: "Automatic check",
	model: "Model check",
	person: "Manual check"
};
export const grader = (verdict: Verdict) => GRADERS[verdict.by ?? "check"];

/** When a trial started: its id is the ISO time of its `pnpm bench` call, with `-` for `:`
 *  and `.`. */
export const day = (trial: Trial) =>
	new Date(trial.id.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, "T$1:$2:$3.$4Z")).toLocaleString("en-GB", {
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit"
	});

type Line = { n: string; word: string };

/** One metric against another's, a run's or a tool's mean, as a ratio worded for whichever
 *  way it goes. A ratio that would read 1.0× is a tie, said as such; with a zero there is no
 *  ratio to show, only the way it goes. */
function ratio(mine: number, theirs: number, better: string, worse: string, same: string): Line {
	if (!(mine > 0 && theirs > 0))
		return { n: "", word: mine === theirs ? same : mine < theirs ? better : worse };
	const n = (Math.max(mine, theirs) / Math.min(mine, theirs)).toFixed(1);
	if (n === "1.0") return { n: "", word: same };
	return { n: `${n}×`, word: mine < theirs ? better : worse };
}

/** Who won a trial, and why. A run must pass to win: when only one did, it wins and that is
 *  the whole story; when both did, the faster wins, with each metric as a ratio worded for
 *  whichever way it goes. No winner when a run is missing, ungraded, or both failed. */
export function outcome(runs: Run[]): { winner: Run | null; lines: Line[]; text: string } {
	const [a, b] = runs;
	if (!b) return { winner: null, lines: [], text: `Only ${armName(a.arm)} ran` };
	if (!a.verdict || !b.verdict) return { winner: null, lines: [], text: "Not graded yet" };
	const passed = runs.filter((r) => r.verdict?.pass);
	if (!passed.length) return { winner: null, lines: [], text: "Both failed" };
	let winner: Run;
	let lines: Line[];
	if (passed.length === 1) {
		winner = passed[0];
		const loser = winner === a ? b : a;
		lines = [{ n: "", word: `${armName(loser.arm)} failed` }];
	} else {
		const other = a.wallMs <= b.wallMs ? b : a;
		winner = other === a ? b : a;
		/** A metric both runs have; none when either lacks it (an imported script run). */
		const both = (mine: number | null, theirs: number | null, ...words: [string, string, string]) =>
			mine === null || theirs === null ? [] : [ratio(mine, theirs, ...words)];
		lines = [
			ratio(winner.wallMs, other.wallMs, "faster", "slower", "about as fast"),
			...both(winner.costUsd, other.costUsd, "cheaper", "costlier", "about the same cost"),
			...both(winner.context, other.context, "smaller context", "larger context", "about the same context")
		];
	}
	const said = lines.map((l) => (l.n ? `${l.n} ${l.word}` : l.word)).join(" · ");
	return { winner, lines, text: `${armName(winner.arm)} won · ${said}` };
}

/** The trial a task is shown by: its newest with both tools, else its newest. */
export const latest = (task: TaskTrials): Trial =>
	task.trials.find((t) => t.runs.length > 1) ?? task.trials[0];

/** Each tool over the latest trial of every task: how many of its graded runs passed, and its
 *  mean time and cost over the tasks both tools passed, so that a fast failure does not pass
 *  for speed. */
export function scoreboard(tasks: TaskTrials[]) {
	const trials = tasks.map(latest).filter((t) => t.runs.length > 1);
	const bothPassed = trials.filter((t) => t.runs.every((r) => r.verdict?.pass));
	const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
	const arms = Object.keys(ARM_NAMES);
	return {
		compared: bothPassed.length,
		arms: arms.map((arm) => {
			const mine = (ts: Trial[]) => ts.flatMap((t) => t.runs.filter((r) => r.arm === arm));
			const graded = mine(trials).filter((r) => r.verdict);
			return {
				arm,
				passed: graded.filter((r) => r.verdict!.pass).length,
				graded: graded.length,
				ms: mean(mine(bothPassed).map((r) => r.wallMs)),
				usd: mean(mine(bothPassed).map((r) => r.costUsd ?? 0))
			};
		})
	};
}

/** The scoreboard in one line: the faster tool over the tasks both passed (the cheaper on a
 *  tie of time), and by how much it was faster and cheaper (or costlier). None until a task has
 *  both tools passing, and none on a tie of both, which no tool leads. */
export function lead(board: ReturnType<typeof scoreboard>) {
	if (!board.compared) return null;
	const [a, b] = board.arms;
	if (a.ms === b.ms && a.usd === b.usd) return null;
	const winner = a.ms < b.ms || (a.ms === b.ms && a.usd < b.usd) ? a : b;
	const other = winner === a ? b : a;
	return {
		arm: winner.arm,
		lines: [
			ratio(winner.ms, other.ms, "faster", "slower", "about as fast"),
			ratio(winner.usd, other.usd, "cheaper", "costlier", "about the same cost")
		]
	};
}

/** A model id as people say it: `claude-opus-5-5` is "Opus 5.5". An id of another shape is
 *  shown as it is. */
export function modelName(id: string): string {
	const m = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/);
	if (!m) return id;
	const [, family, major, minor] = m;
	return `${family[0].toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ""}`;
}
