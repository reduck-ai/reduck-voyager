<!--
	A short analysis of the results, per agent harness and tool Reduck is set against (Hermes' own
	browser on Hermes, Claude in Chrome on Claude Code): for each task, the latest trial of that
	pair, who passed and how Reduck compares with its rival on time, cost and final context; then the typical ratio over the tasks both passed (a geometric mean, so one
	outlier does not carry it); then the notes of whoever read the transcripts (analysis.ts).
-->
<script lang="ts">
	import { NOTES } from "./analysis.ts";
	import { clock } from "./chat/Timeline.svelte";
	import { kTokens, type Rival, type Run, type TaskTrials, type Trial } from "./run.ts";

	/** `notes`: show the written analysis (TL;DR, findings, fixes), which is about the Hermes trial. */
	let { tasks, notes = true }: { tasks: TaskTrials[]; notes?: boolean } = $props();

	const hermes = (t: Trial) => t.runs.every((r) => r.harness === "hermes");
	const MATCHUPS: { id: string; name: string; rival: Rival; rivalName: string; of: (t: Trial) => boolean; notes: Record<string, { summary: string; why?: string[] }> }[] = [
		{ id: "hermes-browser", name: "Hermes · Reduck vs Hermes' own browser", rival: "browser", rivalName: "Browser", of: hermes, notes: NOTES.tasks },
		{ id: "claude-code", name: "Claude Code · Reduck vs Claude in Chrome", rival: "chrome", rivalName: "Chrome", of: (t: Trial) => !t.runs.some((r) => r.harness), notes: {} }
	];

	type Row = { task: TaskTrials; reduck: Run; rival: Run };

	/** Each task's latest trial of the harness that sets Reduck against this rival alone. */
	const rowsOf = (of: (t: Trial) => boolean, rival: Rival): Row[] =>
		tasks.flatMap((task) => {
			const trial = task.trials.find(
				(t) => of(t) && t.runs.length === 2 && t.runs.some((r) => r.arm === "reduck") && t.runs.some((r) => r.arm === rival)
			);
			const reduck = trial?.runs.find((r) => r.arm === "reduck");
			const other = trial?.runs.find((r) => r.arm === rival);
			return reduck && other ? [{ task, reduck, rival: other }] : [];
		});

	/** How many times the rival's value Reduck's is: below 1, Reduck needed less. */
	const ratio = (r: Row, k: "wallMs" | "costUsd" | "context") =>
		r.reduck[k] > 0 && r.rival[k] > 0 ? r.reduck[k] / r.rival[k] : null;

	const geomean = (xs: number[]) =>
		xs.length ? Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length) : null;

	const harnesses = $derived(
		MATCHUPS.map((h) => {
			const rows = rowsOf(h.of, h.rival);
			// A run that went around its tool tests nothing: its task leaves the comparison.
			const both = rows.filter(
				(r) => r.reduck.verdict?.pass && r.rival.verdict?.pass && !r.reduck.offTool && !r.rival.offTool
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
					rival: rows.filter((r) => r.rival.verdict?.pass).length
				},
				typical: { time: typical("wallMs"), cost: typical("costUsd"), context: typical("context") }
			};
		}).filter((h) => h.rows.length)
	);

	/** A Reduck/rival ratio as people read it: "2.1× less" or "1.3× more". */
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

	/** Each task's latest Hermes run of its own browser, with the latest Hermes run of Reduck on
	 *  that task, whatever trial each comes from: until a trial sets the browser against Reduck,
	 *  the only way to read it next to Reduck. A task that has such a trial is in its own table
	 *  instead. */
	const solo = $derived(
		tasks.flatMap((task) => {
			const latestOf = (arm: Run["arm"]) =>
				task.trials.flatMap((t) => t.runs).find((r) => r.harness === "hermes" && r.arm === arm);
			const browser = latestOf("browser");
			const paired = harnesses.some((h) => h.rival === "browser" && h.rows.some((r) => r.task.id === task.id));
			if (!browser || paired) return [];
			return [{ task, browser, reduck: latestOf("reduck") }];
		})
	);
	const cell = (r: Run | undefined) => (r ? `${verdict(r)} ${clock(r.wallMs)} · $${r.costUsd.toFixed(2)}` : "–");

	const offTool = (rows: Row[]) =>
		rows.flatMap((r) =>
			[r.reduck, r.rival].filter((run) => run.offTool).map((run) => `${r.task.name} (${run.arm}): ${run.offTool}`)
		);
</script>

{#if harnesses.length}
	<section class="analysis">
		<h2 class="section">Analysis</h2>
		{#if notes && NOTES.tldr.length}
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
					Passed: <b>Reduck {h.passed.reduck}/{h.rows.length}</b>, {h.rivalName} {h.passed.rival}/{h.rows.length}.
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
								<th>Task</th><th>Passed<br /><small>Reduck · {h.rivalName}</small></th><th>Time</th><th>Cost</th
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
									<td class="mono">{verdict(r.reduck)} · {verdict(r.rival)}</td>
									<td class={tone(time)}
										>{clock(r.reduck.wallMs)} vs {clock(r.rival.wallMs)}<small>{said(time, "faster", "slower")}</small></td
									>
									<td class={tone(cost)}
										>${r.reduck.costUsd.toFixed(2)} vs ${r.rival.costUsd.toFixed(2)}<small
											>{said(cost, "cheaper", "costlier")}</small
										></td
									>
									<td class={tone(context)}
										>{kTokens(r.reduck.context)} vs {kTokens(r.rival.context)}<small
											>{said(context, "smaller", "larger")}</small
										></td
									>
								</tr>
								<!-- The notes were written from the transcripts of these very runs, and their numbers are those runs'. -->
								{#if h.notes[r.task.id]}
									{@const note = h.notes[r.task.id]}
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
		{#if solo.length}
			<div class="harness">
				<h3>
					Hermes' own browser <span
						>on the tasks with no trial against Reduck, next to the latest Hermes run of Reduck</span
					>
				</h3>
				<p class="budget">
					On these tasks no counted trial sets it against Reduck: each column is a separate run, hours apart on the same day.
				</p>
				<div class="wrap">
					<table>
						<thead>
							<tr><th>Task</th><th>Hermes' browser</th><th>Reduck</th></tr>
						</thead>
						<tbody>
							{#each solo as s (s.task.id)}
								<tr>
									<td>{s.task.name}<small>{s.browser.verdict?.detail ?? ""}</small></td>
									<td class="mono">{cell(s.browser)}</td>
									<td class="mono">{cell(s.reduck)}</td>
								</tr>
								{#if NOTES.tasks[s.task.id]}
									{@const note = NOTES.tasks[s.task.id]}
									<tr class="note">
										<td colspan="3">
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
		{/if}
		{#if budgets.length}
			<div class="harness">
				<h3>
					Reduck by concurrency <span
						>Hermes, the same task at each budget of the paired browser, the other tools left out</span
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
		{#if notes && NOTES.findings.length}
			<div class="findings">
				<h3>What the transcripts show</h3>
				<ul>
					{#each NOTES.findings as f}<li>{f}</li>{/each}
				</ul>
				<p class="as-of">Read on {NOTES.asOf}. Every cell is one run: a spread needs the trials repeated.</p>
			</div>
		{/if}
		{#if notes && NOTES.fixes.length}
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
