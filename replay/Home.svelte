<!--
	A scoreboard over the latest run of every task, led by the one line it comes to, then every
	task with results, one card each, laid out like a post: the task, and its prompt as the ask
	it was, cut to two lines with "Show more" for the rest in place; then the comparison, always
	in view: who did better and by how much, and each tool's time, cost and grade; then a bar at
	the bottom with the run (a picker when the task has several) and "Replay", its replay on the
	result. Each tool keeps one colour, its dot and its bar, from the scoreboard to the cards. A
	grade shows why it was given on a click, so the numbers stay scannable. Given a `stage`
	(under `pnpm replay`), the tasks are those of that stage and "Replay" stays in it.
-->
<script lang="ts">
	import { faMedal, faPlay } from "@fortawesome/free-solid-svg-icons";
	import { FontAwesomeIcon } from "@fortawesome/svelte-fontawesome";
	import { untrack } from "svelte";
	import { SvelteSet } from "svelte/reactivity";
	import { clock } from "./chat/Timeline.svelte";
	import {
		ARM_NAMES,
		day,
		grader,
		latest,
		lead,
		outcome,
		scoreboard,
		verdictLabel,
		type Stage,
		type TaskTrials,
		type Trial
	} from "./run.ts";

	let { tasks, stage }: { tasks: TaskTrials[]; stage?: Stage } = $props();

	let picked = $state(untrack(() => Object.fromEntries(tasks.map((t) => [t.id, latest(t).id]))));
	const board = $derived(scoreboard(tasks));
	const headline = $derived(lead(board));
	/** Tasks whose prompt is cut, those shown whole, and runs whose grade's reason is shown. */
	const cut = new SvelteSet<string>();
	const prompts = new SvelteSet<string>();
	const reasons = new SvelteSet<string>();
	/** Marks a task whose prompt overflows its two lines, so only those offer "Show more". */
	const measure = (node: HTMLElement, id: string) => {
		if (node.scrollHeight > node.clientHeight) cut.add(id);
	};
	const toggle = (set: SvelteSet<string>, id: string) => (set.has(id) ? set.delete(id) : set.add(id));

	const replay = (trial: Trial) =>
		`?${trial.runs.map((r) => `run=${encodeURIComponent(r.id)}`).join("&")}${stage ? `&stage=${stage}` : ""}&t=end`;
</script>

<main>
	<header>
		<div class="top">
			<a class="by" href="https://reduck.ai">by <img src="./reduck.png" alt="Reduck" /></a>
			<a class="github" href="https://github.com/reduck-ai/reduck-voyager">
				<!-- GitHub's mark (primer/octicons, mark-github-16). -->
				<svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
					<path
						d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"
					/>
				</svg>
				GitHub
			</a>
		</div>
		<h1>Reduck Voyager</h1>
		<p class="tagline">Evals for AI agents on real browser tasks.</p>
		<p>
			An open-source framework that tests agents on real knowledge work in the browser: market
			research, SEO, go-to-market. Define an eval in one file, run it, read every step, and
			share the results.
		</p>
	</header>

	<section class="board">
		<!-- A table to a screen reader; the rows stay grids, so a phone can fold them. -->
		<div role="table" aria-labelledby="metrics">
			<div class="row head" role="row">
				<span role="columnheader"><h2 id="metrics">Key metrics</h2></span><span role="columnheader"
					>Passed</span
				><span role="columnheader">Avg time*</span><span role="columnheader">Avg cost*</span>
			</div>
			{#each board.arms as a (a.arm)}
				<div class="row" role="row">
					<span class="arm" role="rowheader" style:--arm="var(--{a.arm})">{ARM_NAMES[a.arm]}</span>
					<span role="cell">{a.passed}/{a.graded}</span>
					<span role="cell">{board.compared ? clock(a.ms) : "–"}</span>
					<span role="cell">{board.compared ? `$${a.usd.toFixed(2)}` : "–"}</span>
				</div>
			{/each}
		</div>
		{#if headline}
			<p class="lead" style:--arm="var(--{headline.arm})">
				<FontAwesomeIcon icon={faMedal} />
				<span
					><b>{ARM_NAMES[headline.arm]}</b>{#each headline.lines as line}{" · "}<span class="metric"
							>{#if line.n}<b>{line.n}</b>{" "}{/if}{line.word}</span
						>{/each}, on the {board.compared}
					{board.compared === 1 ? "task" : "tasks"} both passed</span
				>
			</p>
		{/if}
		<p class="note">
			{#if board.compared}
				* Time and cost are the mean over the {board.compared}
				{board.compared === 1 ? "task" : "tasks"} both tools passed.
			{:else}
				* Time and cost show once both tools pass a task.
			{/if}
		</p>
	</section>

	<h2 class="section">Tasks <span>{tasks.length}</span></h2>

	{#each tasks as task (task.id)}
		{@const trial = task.trials.find((t) => t.id === picked[task.id])!}
		{@const result = outcome(trial.runs)}
		{@const longest = Math.max(...trial.runs.map((r) => r.wallMs))}
		<article>
			<h3>{task.name}</h3>
			<!-- The ask, as the replay's chat shows it. -->
			<div class="ask">
				<p class="label">Prompt</p>
				<p class="prompt" class:whole={prompts.has(task.id)} use:measure={task.id}>{task.prompt}</p>
				{#if cut.has(task.id)}
					<button class="more" onclick={() => toggle(prompts, task.id)}>
						{prompts.has(task.id) ? "Show less" : "Show more"}
					</button>
				{/if}
			</div>

			<div class="comparison">
				<p class="outcome" class:win={result.winner} style:--arm={result.winner && `var(--${result.winner.arm})`}>
					{#if result.winner}
						<FontAwesomeIcon icon={faMedal} />
						<span
							><b>{ARM_NAMES[result.winner.arm]} won</b>{#each result.lines as line}{" · "}<span
									class="metric">{#if line.n}<b>{line.n}</b>{" "}{/if}{line.word}</span
								>{/each}</span
						>
					{:else}
						{result.text}
					{/if}
				</p>
				{#each trial.runs as run (run.id)}
					{@const why = reasons.has(run.id)}
					<div class="run" style:--arm="var(--{run.arm})">
						<span class="arm">{ARM_NAMES[run.arm]}</span>
						<span class="bar"><span style:width="{(run.wallMs / longest) * 100}%"></span></span>
						<span class="n">{clock(run.wallMs)}</span>
						<span class="n">${run.costUsd.toFixed(2)}</span>
						{#if run.verdict?.detail}
							<button
								class="grade"
								class:pass={run.verdict.pass}
								class:fail={!run.verdict.pass}
								aria-expanded={why}
								title="Why?"
								onclick={() => toggle(reasons, run.id)}>{verdictLabel(run)}</button
							>
						{:else}
							<span class="grade" class:pass={run.verdict?.pass} class:fail={run.verdict?.pass === false}
								>{verdictLabel(run)}</span
							>
						{/if}
					</div>
					{#if why && run.verdict?.detail}
						<p class="why">By {grader(run.verdict)}: {run.verdict.detail}</p>
					{/if}
				{/each}
			</div>

			<footer>
				{#if task.trials.length > 1}
					<select bind:value={picked[task.id]} aria-label="Run">
						{#each task.trials as t (t.id)}<option value={t.id}>{day(t)}</option>{/each}
					</select>
				{:else}
					<span>{day(trial)}</span>
				{/if}
				<a class="open" href={replay(trial)}><FontAwesomeIcon icon={faPlay} /> Replay</a>
			</footer>
		</article>
	{/each}
</main>

<style>
	main {
		max-width: 768px;
		margin: 0 auto;
		padding: 32px 16px 64px;
	}
	header {
		margin-bottom: 32px;
	}
	.top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 40px;
		font-size: 13px;
		color: var(--ink-3);
	}
	.top a {
		color: inherit;
		text-decoration: none;
	}
	/* A primary button, like "Replay": the one call to action up here. */
	.top .github {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 14px;
		border-radius: 8px;
		background: var(--ink);
		color: #f9fafb;
		font-size: 14px;
	}
	.top .github:hover {
		background: #1f2937;
		color: #f9fafb;
	}
	.top a:hover {
		color: var(--ink);
	}
	/* The approved lockup, at the 20 px minimum height the logo rules set. */
	.by {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.by img {
		height: 20px;
	}
	h1 {
		margin: 0;
		font-size: 40px;
		line-height: 48px;
		font-weight: 600;
		letter-spacing: -0.025em;
	}
	/* The brand orange marks Reduck's data below, so the words up here stay in ink. */
	.tagline {
		margin: 6px 0 12px;
		font-size: 20px;
		line-height: 28px;
		font-weight: 500;
		color: var(--ink);
	}
	header p:not(.tagline) {
		margin: 0;
		max-width: 620px;
		font-size: 16px;
		line-height: 24px;
		color: var(--ink-2);
	}
	a {
		color: inherit;
	}
	/* A tool's name after its dot, in the tool's colour, `--arm`. */
	.arm {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		font-weight: 600;
	}
	.arm::before {
		content: "";
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--arm);
	}
	.board {
		/* Chrome's ink would vanish on the board's own. */
		--chrome: #d1d5db;
		margin-bottom: 40px;
		padding: 18px 20px 16px;
		border-radius: 12px;
		background: var(--ink);
		color: #f3f4f6;
	}
	.board .row {
		display: grid;
		grid-template-columns: 1fr 80px 90px 90px;
		gap: 10px;
		align-items: center;
		padding: 8px 0;
		font-variant-numeric: tabular-nums;
		font-size: 17px;
	}
	.board .row + .row {
		border-top: 1px solid rgb(255 255 255 / 0.08);
	}
	.board .row span:not(:first-child) {
		text-align: right;
	}
	.board .head {
		align-items: end;
		padding-top: 0;
		font-size: 12px;
		color: #9ca3af;
	}
	.board h2 {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		color: #f9fafb;
	}
	.board .arm {
		color: #f9fafb;
	}
	/* What the table comes to, set apart from it like the replay's winner card. */
	.lead {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin: 10px 0 0;
		padding: 10px 12px;
		border-radius: 8px;
		background: rgb(255 255 255 / 0.06);
		color: #d1d5db;
		font-size: 15px;
		:global(svg) {
			flex: none;
			color: var(--arm);
		}
		b {
			color: #f9fafb;
			font-weight: 600;
		}
	}
	/* A ratio and its word, never split across lines. */
	.metric {
		white-space: nowrap;
	}
	.note {
		margin: 10px 0 0;
		font-size: 12px;
		color: #9ca3af;
	}
	.section {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 0 12px;
		font-size: 15px;
		font-weight: 600;
	}
	.section span {
		padding: 0 7px;
		border-radius: 10px;
		background: rgb(17 24 39 / 0.06);
		font-size: 12px;
		line-height: 20px;
		font-weight: 500;
		color: var(--ink-2);
	}
	article {
		margin-bottom: 16px;
		padding: 18px 20px 12px;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: white;
		box-shadow: 0 1px 2px rgb(17 24 39 / 0.04);
	}
	h3 {
		margin: 0;
		font-size: 17px;
		line-height: 24px;
		font-weight: 600;
	}
	.ask {
		margin-top: 10px;
		padding: 10px 12px;
		border-radius: 10px;
		/* Light enough that its grey label keeps 4.5:1. */
		background: rgb(17 24 39 / 0.03);
	}
	.label {
		margin: 0 0 2px;
		color: var(--ink-3);
		font-size: 12px;
		font-weight: 500;
	}
	/* Two lines with an ellipsis until "Show more". */
	.prompt {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: var(--ink-2);
	}
	.prompt.whole {
		display: block;
	}
	/* An inline link, as under a post's text. */
	.more {
		margin-top: 2px;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		color: var(--brand-text);
		cursor: pointer;
	}
	.more:hover {
		text-decoration: underline;
	}
	.comparison {
		margin-top: 16px;
	}
	.outcome {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin: 0 0 6px;
		color: var(--ink-3);
	}
	.outcome.win {
		color: var(--ink-2);
		:global(svg) {
			flex: none;
			color: var(--arm);
		}
		b {
			color: var(--ink);
			font-weight: 600;
		}
	}
	.run {
		display: grid;
		grid-template-columns: 190px 1fr 48px 52px 96px;
		align-items: center;
		gap: 10px;
		margin-top: 8px;
		font-variant-numeric: tabular-nums;
	}
	.bar {
		height: 8px;
		border-radius: 4px;
		background: rgb(17 24 39 / 0.06);
	}
	.bar span {
		display: block;
		height: 100%;
		border-radius: 4px;
		background: var(--arm);
	}
	.n {
		text-align: right;
	}
	.grade {
		justify-self: end;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: var(--ink-3);
	}
	.grade.pass {
		color: var(--pass);
	}
	.grade.fail {
		color: var(--fail);
	}
	/* A grade with a reason reads as something to click. */
	button.grade {
		cursor: pointer;
		text-decoration: underline dotted;
		text-underline-offset: 3px;
	}
	.why {
		margin: 4px 0 0 200px;
		color: var(--ink-3);
		font-size: 13px;
		line-height: 18px;
	}
	/* The post's action bar: the run it shows, and where to open it. */
	footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		margin-top: 16px;
		padding-top: 12px;
		border-top: 1px solid var(--line);
		color: var(--ink-3);
		font-size: 13px;
	}
	/* Text in the bar, like a single run's date, with only its arrow to say it is a picker. */
	select {
		max-width: 75%;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	select:hover {
		color: var(--ink);
	}
	.open {
		flex: none;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 14px;
		border-radius: 8px;
		background: var(--ink);
		color: #f9fafb;
		font-size: 14px;
		font-weight: 500;
		text-decoration: none;
		:global(svg) {
			font-size: 11px;
		}
	}
	.open:hover {
		background: #1f2937;
	}
	/* A phone: a tool's name gets a line of its own, over its numbers. */
	@media (max-width: 600px) {
		main {
			padding-top: 20px;
		}
		.top {
			margin-bottom: 28px;
		}
		h1 {
			font-size: 32px;
			line-height: 40px;
		}
		.tagline {
			font-size: 18px;
			line-height: 26px;
		}
		.board .row {
			grid-template-columns: repeat(3, 1fr);
			row-gap: 4px;
		}
		.board .row > :first-child {
			grid-column: 1 / -1;
		}
		.board .row span:not(:first-child) {
			text-align: left;
		}
		.board .head h2 {
			margin-bottom: 6px;
		}
		article {
			padding: 16px 16px 12px;
		}
		/* A fixed grade column, as wide as "Not graded": each row is its own grid, so a
		   column sized to its content would give each run a bar track of its own length. */
		.run {
			grid-template-columns: 1fr 44px 50px 76px;
			row-gap: 4px;
			margin-top: 12px;
		}
		.run .arm {
			grid-column: 1 / -1;
		}
		.why {
			margin-left: 0;
		}
	}
</style>
