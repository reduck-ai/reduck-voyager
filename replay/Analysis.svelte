<!--
	A short analysis of the results, per agent harness: for each task, the latest trial of that
	harness with both tools, who passed and how Reduck compares with Chrome on time, cost and
	final context; then the typical ratio over the tasks both passed (a geometric mean, so one
	outlier does not carry it); then the notes of whoever read the transcripts (analysis.ts).
-->
<script lang="ts">
	import { NOTES } from "./analysis.ts";
	import { clock } from "./chat/Timeline.svelte";
	import { kTokens, type Run, type TaskTrials, type Trial } from "./run.ts";

	let { tasks }: { tasks: TaskTrials[] } = $props();

	const HARNESSES = [
		{ id: "hermes", name: "Hermes", of: (t: Trial) => t.runs.some((r) => r.harness === "hermes") },
		{ id: "claude-code", name: "Claude Code", of: (t: Trial) => !t.runs.some((r) => r.harness) }
	];

	type Row = { task: TaskTrials; reduck: Run; chrome: Run };

	/** Each task's latest trial of the harness with both tools. */
	const rowsOf = (of: (t: Trial) => boolean): Row[] =>
		tasks.flatMap((task) => {
			const trial = task.trials.find((t) => of(t) && t.runs.length > 1);
			const reduck = trial?.runs.find((r) => r.arm === "reduck");
			const chrome = trial?.runs.find((r) => r.arm === "chrome");
			return reduck && chrome ? [{ task, reduck, chrome }] : [];
		});

	/** How many times Chrome's value Reduck's is: below 1, Reduck needed less. */
	const ratio = (r: Row, k: "wallMs" | "costUsd" | "context") =>
		r.reduck[k] > 0 && r.chrome[k] > 0 ? r.reduck[k] / r.chrome[k] : null;

	const geomean = (xs: number[]) =>
		xs.length ? Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length) : null;

	const harnesses = $derived(
		HARNESSES.map((h) => {
			const rows = rowsOf(h.of);
			// A run that went around its tool tests nothing: its task leaves the comparison.
			const both = rows.filter(
				(r) => r.reduck.verdict?.pass && r.chrome.verdict?.pass && !r.reduck.offTool && !r.chrome.offTool
			);
			const typical = (k: "wallMs" | "costUsd" | "context") =>
				geomean(both.map((r) => ratio(r, k)).filter((x): x is number => x !== null));
			return {
				...h,
				rows,
				concurrency: [...new Set(rows.map((r) => r.reduck.reduckConcurrency))],
				strays: offTool(rows),
				both: both.length,
				passed: {
					reduck: rows.filter((r) => r.reduck.verdict?.pass).length,
					chrome: rows.filter((r) => r.chrome.verdict?.pass).length
				},
				typical: { time: typical("wallMs"), cost: typical("costUsd"), context: typical("context") }
			};
		}).filter((h) => h.rows.length)
	);

	/** A Reduck/Chrome ratio as people read it: "2.1× less" or "1.3× more". */
	const said = (x: number | null, less: string, more: string) =>
		x === null
			? "–"
			: Math.abs(x - 1) < 0.05
				? "about the same"
				: x < 1
					? `${(1 / x).toFixed(1)}× ${less}`
					: `${x.toFixed(1)}× ${more}`;
	const tone = (x: number | null) => (x === null || Math.abs(x - 1) < 0.05 ? "" : x < 1 ? "good" : "bad");
	const verdict = (r: Run) => (r.offTool ? "⚠" : r.verdict ? (r.verdict.pass ? "✓" : "✗") : "–");
	const concurrencyLabel = (values: (number | undefined)[]) =>
		values.length === 1 && values[0]
			? `concurrency ${values[0]}`
			: values.every((v) => v)
				? `concurrency ${values.join(" and ")}, depending on the task`
				: "a concurrency not recorded for every run";

	/** Each task's latest Hermes Reduck run at each concurrency budget, for tasks run at two or more:
	 *  the same tool on the same task, the budget the only change. */
	const budgets = $derived(
		tasks.flatMap((task) => {
			const at = new Map<number, Run>();
			for (const trial of task.trials)
				for (const run of trial.runs)
					if (run.harness === "hermes" && run.arm === "reduck" && run.reduckConcurrency && !at.has(run.reduckConcurrency))
						at.set(run.reduckConcurrency, run);
			const runs = [...at.entries()].sort(([a], [b]) => a - b);
			return runs.length > 1 ? [{ task, runs }] : [];
		})
	);

	const offTool = (rows: Row[]) =>
		rows.flatMap((r) =>
			[r.reduck, r.chrome].filter((run) => run.offTool).map((run) => `${r.task.name} (${run.arm}): ${run.offTool}`)
		);
</script>

{#if harnesses.length}
	<section class="analysis">
		<h2 class="section">Analysis</h2>
		{#if NOTES.tldr.length}
			<div class="tldr">
				<h3>TL;DR</h3>
				<ul>
					{#each NOTES.tldr as point}<li>{point}</li>{/each}
				</ul>
			</div>
		{/if}
		{#each harnesses as h (h.id)}
			<div class="harness">
				<h3>{h.name} <span>{h.rows.length} {h.rows.length === 1 ? "task" : "tasks"} with both tools</span></h3>
				<p class="budget">
					Reduck ran on the paired browser at <b>{concurrencyLabel(h.concurrency)}</b> (scripts at once) in these results.
				</p>
				<p class="summary">
					Passed: <b>Reduck {h.passed.reduck}/{h.rows.length}</b>, Chrome {h.passed.chrome}/{h.rows.length}.
					{#if h.both}
						On the {h.both} {h.both === 1 ? "task" : "tasks"} both passed, Reduck took
						<b class={tone(h.typical.time)}>{said(h.typical.time, "less time", "more time")}</b>, cost
						<b class={tone(h.typical.cost)}>{said(h.typical.cost, "less", "more")}</b> and ended with
						<b class={tone(h.typical.context)}>{said(h.typical.context, "less context", "more context")}</b>.
					{/if}
				</p>
				<p class="audit" class:bad={h.strays.length}>
					{#if h.strays.length}
						⚠ Left out of the comparison, for not using their tool alone: {h.strays.join("; ")}.
					{:else}
						Tool use checked on every run: each used its own tool, never the other one, and reached no site around it.
					{/if}
				</p>
				<div class="wrap">
					<table>
						<thead>
							<tr>
								<th>Task</th><th>Passed<br /><small>Reduck · Chrome</small></th><th>Time</th><th>Cost</th
								><th>Final context</th>
							</tr>
						</thead>
						<tbody>
							{#each h.rows as r (r.task.id)}
								{@const time = ratio(r, "wallMs")}
								{@const cost = ratio(r, "costUsd")}
								{@const context = ratio(r, "context")}
								<tr>
									<td
										>{r.task.name}<small
											>Reduck at concurrency {r.reduck.reduckConcurrency ?? "not recorded"}</small
										></td
									>
									<td class="mono">{verdict(r.reduck)} · {verdict(r.chrome)}</td>
									<td class={tone(time)}
										>{clock(r.reduck.wallMs)} vs {clock(r.chrome.wallMs)}<small>{said(time, "faster", "slower")}</small></td
									>
									<td class={tone(cost)}
										>${r.reduck.costUsd.toFixed(2)} vs ${r.chrome.costUsd.toFixed(2)}<small
											>{said(cost, "cheaper", "costlier")}</small
										></td
									>
									<td class={tone(context)}
										>{kTokens(r.reduck.context)} vs {kTokens(r.chrome.context)}<small
											>{said(context, "smaller", "larger")}</small
										></td
									>
								</tr>
								<!-- The notes were written from the Hermes transcripts, and their numbers are those runs'. -->
								{#if h.id === "hermes" && NOTES.tasks[r.task.id]}
									{@const note = NOTES.tasks[r.task.id]}
									<tr class="note">
										<td colspan="5">
											<p>{note.summary}</p>
											{#if note.why?.length}
												<details>
													<summary>Why</summary>
													<ul>
														{#each note.why as w}<li>{w}</li>{/each}
													</ul>
												</details>
											{/if}
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/each}
		{#if budgets.length}
			<div class="harness">
				<h3>
					Reduck by concurrency <span
						>Hermes, the same task at each budget of the paired browser, Chrome left out</span
					>
				</h3>
				<div class="wrap">
					<table>
						<thead>
							<tr><th>Task</th><th>Concurrency</th><th>Passed</th><th>Time</th><th>Cost</th><th>Final context</th></tr>
						</thead>
						<tbody>
							{#each budgets as b (b.task.id)}
								{#each b.runs as [budget, run], i (budget)}
									<tr class:first={i === 0}>
										<td>{i === 0 ? b.task.name : ""}</td>
										<td class="mono">{budget} at once</td>
										<td class="mono">{verdict(run)}</td>
										<td>{clock(run.wallMs)}</td>
										<td>${run.costUsd.toFixed(2)}</td>
										<td>{kTokens(run.context)}</td>
									</tr>
								{/each}
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
		{#if NOTES.findings.length}
			<div class="findings">
				<h3>What the transcripts show</h3>
				<ul>
					{#each NOTES.findings as f}<li>{f}</li>{/each}
				</ul>
				<p class="as-of">Read on {NOTES.asOf}. Every cell is one run: a spread needs the trials repeated.</p>
			</div>
		{/if}
		{#if NOTES.fixes.length}
			<div class="findings fixes">
				<h3>What Reduck should fix</h3>
				<ol>
					{#each NOTES.fixes as f}<li>{f}</li>{/each}
				</ol>
			</div>
		{/if}
	</section>
{/if}

<style>
	.analysis {
		margin-bottom: 40px;
	}
	.section {
		margin: 0 0 12px;
		font-size: 16px;
		font-weight: 600;
	}
	.harness + .harness {
		margin-top: 24px;
	}
	h3 {
		margin: 0 0 4px;
		font-size: 15px;
		font-weight: 600;
		span {
			margin-left: 6px;
			font-weight: 400;
			color: var(--ink-2);
			font-size: 13px;
		}
	}
	.tldr {
		margin-bottom: 20px;
		padding: 12px 16px;
		border-left: 3px solid var(--brand);
		border-radius: 6px;
		background: var(--surface);
		ul {
			margin: 6px 0 0;
			padding-left: 18px;
			font-size: 14px;
			line-height: 22px;
		}
	}
	.budget {
		margin: 0 0 4px;
		font-size: 13px;
		color: var(--ink-2);
		b {
			color: var(--ink);
		}
	}
	.summary {
		margin: 0 0 10px;
		font-size: 14px;
		line-height: 22px;
		color: var(--ink-2);
		b {
			color: var(--ink);
		}
	}
	.wrap {
		overflow-x: auto;
	}
	.audit {
		margin: 0 0 10px;
		font-size: 12px;
		color: var(--ink-2);
		&.bad {
			color: var(--fail);
		}
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		text-align: left;
		padding: 7px 8px;
		border-bottom: 1px solid var(--line);
		vertical-align: top;
	}
	th {
		font-weight: 500;
		font-size: 12px;
		color: var(--ink-2);
	}
	td small,
	th small {
		display: block;
		font-size: 11px;
		color: var(--ink-2);
	}
	td.good small,
	b.good {
		color: var(--pass);
	}
	td.bad small,
	b.bad {
		color: var(--fail);
	}
	.mono {
		white-space: nowrap;
	}
	tr.note td {
		padding-top: 0;
		font-size: 12px;
		line-height: 18px;
		color: var(--ink-2);
	}
	.findings {
		margin-top: 20px;
		padding: 14px 16px;
		border-radius: 10px;
		background: var(--surface);
		ul {
			margin: 6px 0 8px;
			padding-left: 18px;
			font-size: 14px;
			line-height: 22px;
		}
	}
	tr.note p {
		margin: 0 0 4px;
		color: var(--ink);
	}
	tr.note details {
		margin-bottom: 4px;
	}
	tr.note summary {
		cursor: pointer;
		color: var(--brand-text);
		font-weight: 500;
	}
	tr.note ul {
		margin: 4px 0 0;
		padding-left: 18px;
	}
	.fixes {
		margin-top: 12px;
		ol {
			margin: 6px 0 0;
			padding-left: 20px;
			font-size: 14px;
			line-height: 22px;
		}
		li + li {
			margin-top: 4px;
		}
	}
	.as-of {
		margin: 0;
		font-size: 12px;
		color: var(--ink-2);
	}
</style>
