<!--
	Recorded runs side by side on one timeline, as long as the longest of them, each from its own
	start, under the task they ran. A run that has finished is marked on the timeline, and its lane
	greys out under what it came to: the verdict and why, its time, its cost. Once two runs have both finished, a card between
	them names the winner and why (see `outcome` in run.ts). A card closes into a "Show results"
	button in its lane's header, which brings it back; the card between them shows while no card
	is closed. A lane collapses into a thin rail, and
	the others take its room; one at most, so there is always a comparison to go back to. A click on a run's screen moves it over the lane next to it, larger, until it is
	closed.

	`t` is the moment shown, in ms, bound to the page so it outlives a change of stage; one past
	the longest run is brought back to its end. Under `pnpm replay` each lane names its stage, and
	a lane is keyed by id and stage, so one run can fill two lanes (raw next to draft).
-->
<script lang="ts">
	import { faMedal, faXmark } from "@fortawesome/free-solid-svg-icons";
	import { FontAwesomeIcon } from "@fortawesome/svelte-fontawesome";
	import { SvelteSet } from "svelte/reactivity";
	import { fade, scale } from "svelte/transition";
	import Chat from "./chat/Chat.svelte";
	import { screenAt } from "./chat/chat.ts";
	import Screen, { receive, send } from "./chat/Screen.svelte";
	import Timeline, { clock } from "./chat/Timeline.svelte";
	import {
		ARM_NAMES,
		grader,
		kTokens,
		modelName,
		verdictLabel,
		outcome,
		type RunWithSession,
		type Stage,
		type TaskTrials
	} from "./run.ts";

	type Lane = RunWithSession & { stage: Stage };
	let {
		runs,
		task,
		t = $bindable(0),
		speed,
		autoplay
	}: {
		runs: Lane[];
		task?: TaskTrials;
		t?: number;
		speed?: number;
		autoplay?: boolean;
	} = $props();
	const ref = (run: Lane) => `${run.id}@${run.stage}`;

	/** The runs whose result card is closed, and those whose reason is shown whole. */
	const closed = new SvelteSet<string>();
	const whole = new SvelteSet<string>();

	/** The run whose screen is shown large, and the lane it covers: the next, or for the last
	 *  run the one before. */
	let staged = $state<number | null>(null);
	const covered = $derived(
		staged === null ? null : staged === runs.length - 1 ? staged - 1 : staged + 1
	);

	const duration = $derived(Math.max(...runs.map((r) => r.session.durationMs)));
	$effect.pre(() => {
		if (t > duration) t = duration;
	});

	/** The run whose lane is collapsed: one at most. Collapsing puts back any large screen,
	 *  which covers the lane next to its own. */
	let collapsed = $state<string | null>(null);
	const collapse = (id: string) => {
		collapsed = id;
		staged = null;
	};
	/** The edge a lane folds toward: the last lane's is its right, every other's its left. */
	const side = (i: number) => (i > 0 && i === runs.length - 1 ? "right" : "left");
	const columns = $derived(
		runs.map((r) => (ref(r) === collapsed ? "44px" : "minmax(0, 1fr)")).join(" ")
	);

	const result = $derived(runs.length === 2 ? outcome(runs) : null);
	const marks = $derived(
		runs.map((r) => ({ at: r.session.durationMs, label: ARM_NAMES[r.arm] }))
	);
</script>

<!-- A panel with a bar on the edge it folds toward, as in Google's notebook. -->
{#snippet panel(edge: "left" | "right")}
	<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
		<rect x="1.75" y="1.75" width="12.5" height="12.5" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.5" />
		<rect x={edge === "left" ? 4.5 : 9.5} y="4.5" width="2" height="7" rx="1" fill="currentColor" />
	</svg>
{/snippet}

<div class="compare">
	<nav>
		<a href="./">← All tasks</a>
		{#if task}<strong>{task.name}</strong>{/if}
	</nav>
	<div class="lanes" style:grid-template-columns={columns}>
		{#each runs as run, i (ref(run))}
			{@const done = t >= run.session.durationMs}
			<section>
				{#if collapsed === ref(run)}
					<button class="rail" onclick={() => (collapsed = null)} title="Expand">
						{@render panel(side(i))}
						<span>{ARM_NAMES[run.arm]}</span>
						{#if done}<span>{verdictLabel(run)}</span>{/if}
					</button>
				{:else}
				<header>
					<span>
						<strong class="arm" style:--arm="var(--{run.arm})">{ARM_NAMES[run.arm]}</strong>
						<span class="model">· {run.session.models.map(modelName).join(", ")}</span>
						{#if import.meta.env.DEV}<span class="at">{run.stage}</span>{/if}
					</span>
					<span class="actions">
						{#if done && closed.has(ref(run))}
							<button
								class="results"
								onclick={() => closed.delete(ref(run))}
								in:receive={{ key: run }}
								out:send={{ key: run }}
							>
								Show results
							</button>
						{/if}
						{#if runs.length > 1}
							<button class="collapse" onclick={() => collapse(ref(run))} title="Collapse">
								{@render panel(side(i))}
							</button>
						{/if}
					</span>
				</header>
				<Chat
					chat={run.session}
					{t}
					expanded={staged === i}
					onexpand={runs.length > 1 && !collapsed ? () => (staged = i) : undefined}
				/>
				{#if done && !closed.has(ref(run))}
					<div class="veil" transition:fade={{ duration: 200 }}>
						<div class="card" in:receive={{ key: run }} out:send={{ key: run }}>
							<button class="close" onclick={() => closed.add(ref(run))} aria-label="Close">
								<FontAwesomeIcon icon={faXmark} />
							</button>
							<div class="verdict">{verdictLabel(run)}</div>
							<div class="metrics">
								<div><b>{clock(run.wallMs)}</b>time</div>
								<div><b>${run.costUsd.toFixed(2)}</b>cost</div>
								<div><b>{kTokens(run.context)}</b>final context</div>
							</div>
							{#if run.verdict?.detail}
								<button class="why" class:open={whole.has(ref(run))} onclick={() => whole.add(ref(run))}>
									<span>Why, by {grader(run.verdict)}:</span>
									{run.verdict.detail}
								</button>
							{/if}
						</div>
					</div>
				{/if}
				{#if staged !== null && covered === i}
					{@const shown = runs[staged]}
					{@const screen = screenAt(shown.session, t)}
					<div class="stage" in:receive={{ key: shown.session }} out:send={{ key: shown.session }}>
						<header>
							<strong>{ARM_NAMES[shown.arm]}</strong>
							<button onclick={() => (staged = null)} aria-label="Back to picture in picture">
								<FontAwesomeIcon icon={faXmark} />
							</button>
						</header>
						{#if screen}<Screen {screen} />{/if}
					</div>
				{/if}
				{/if}
			</section>
		{/each}
		{#if result?.winner && t >= duration && !closed.size && !collapsed}
			<div class="versus" transition:scale={{ start: 0.9, duration: 300 }}>
				<div class="winner">
					<FontAwesomeIcon icon={faMedal} />
					{ARM_NAMES[result.winner.arm]} wins
				</div>
				{#each result.lines as line}<div>{#if line.n}<b>{line.n}</b>{/if} {line.word}</div>{/each}
			</div>
		{/if}
	</div>
	<Timeline {duration} {marks} bind:t {speed} {autoplay} />
</div>

<style>
	.compare {
		height: 100vh;
		display: flex;
		flex-direction: column;
		background: #f5f4ef;
	}
	nav {
		display: flex;
		gap: 16px;
		align-items: baseline;
		padding: 10px 16px;
		border-bottom: 1px solid rgb(11 11 11 / 0.1);
	}
	nav a {
		color: #7b7a74;
		text-decoration: none;
	}
	nav a:hover {
		color: #0b0b0b;
	}
	.lanes {
		position: relative;
		flex: 1;
		min-height: 0;
		display: grid;
		grid-auto-columns: minmax(0, 1fr);
		grid-auto-flow: column;
		grid-template-rows: minmax(0, 1fr);
		border-bottom: 1px solid rgb(11 11 11 / 0.1);
	}
	/* Grid rows give the chat a fixed height to fill, which a flex column would not. */
	section {
		position: relative;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		grid-template-columns: minmax(0, 1fr);
		border-left: 1px solid rgb(11 11 11 / 0.1);
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 16px;
		font-variant-numeric: tabular-nums;
	}
	/* Over the whole lane; the chat stays readable and clickable under it. */
	.veil {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgb(233 232 226 / 0.72);
		pointer-events: none;
	}
	/* Where the lanes meet, level with the cards of the finished runs. */
	.versus {
		position: absolute;
		left: 50%;
		top: 50%;
		translate: -50% -50%;
		z-index: 2;
		padding: 18px 26px;
		border-radius: 14px;
		background: #0b0b0b;
		color: #e9e8e2;
		text-align: center;
		font-size: 15px;
		line-height: 24px;
		box-shadow: 0 8px 32px rgb(11 11 11 / 0.3);
		pointer-events: none;
	}
	.winner {
		margin-bottom: 6px;
		color: white;
		font-size: 17px;
		font-weight: 600;
		:global(svg) {
			color: #e8b04b;
		}
	}
	.versus b {
		color: white;
		font-size: 20px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	/* A dot in the tool's colour, `--arm`, the one it has on the home page. */
	.arm::before {
		content: "";
		display: inline-block;
		width: 8px;
		height: 8px;
		margin-right: 8px;
		border-radius: 50%;
		background: var(--arm);
		vertical-align: 1px;
	}
	.model {
		color: #7b7a74;
	}
	/* The stage a lane shows, under `pnpm replay`. */
	.at {
		margin-left: 6px;
		padding: 1px 6px;
		border-radius: 4px;
		background: rgb(11 11 11 / 0.06);
		font-size: 12px;
		color: #3d3d3a;
	}
	/* Over the covered lane, its veil included. */
	.stage {
		position: absolute;
		inset: 0;
		z-index: 1;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		background: #e9e8e2;
		box-shadow: 0 6px 32px rgb(11 11 11 / 0.2);
	}
	.stage button {
		border: 0;
		background: none;
		font-size: 22px;
		line-height: 20px;
		cursor: pointer;
		color: #3d3d3a;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.collapse {
		padding: 0;
		border: 0;
		background: none;
		font-size: 15px;
		color: #7b7a74;
		cursor: pointer;
	}
	.collapse:hover {
		color: #0b0b0b;
	}
	/* A collapsed lane: its tool and grade, read top to bottom, and a click opens it again. */
	.rail {
		grid-row: 1 / -1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 12px 0;
		border: 0;
		background: #e9e8e2;
		font: inherit;
		font-size: 13px;
		color: #3d3d3a;
		cursor: pointer;
	}
	.rail span {
		writing-mode: vertical-rl;
		white-space: nowrap;
	}
	.rail:hover {
		background: #deddd6;
	}
	.results {
		padding: 4px 12px;
		border: 0;
		border-radius: 6px;
		background: #0b0b0b;
		color: white;
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}
	.results:hover {
		background: #3d3d3a;
	}
	/* The veil lets clicks through to the chat; its card takes them back. */
	.card {
		position: relative;
		pointer-events: auto;
		padding: 20px 28px;
		border-radius: 12px;
		background: white;
		box-shadow: 0 4px 24px rgb(11 11 11 / 0.12);
		text-align: center;
	}
	.close {
		position: absolute;
		top: 8px;
		right: 10px;
		border: 0;
		background: none;
		font-size: 16px;
		color: #7b7a74;
		cursor: pointer;
	}
	.close:hover {
		color: #0b0b0b;
	}
	.verdict {
		font-size: 16px;
		font-weight: 600;
		margin-bottom: 12px;
	}
	.metrics {
		display: flex;
		gap: 28px;
		color: #7b7a74;
		font-size: 12px;
	}
	/* Cut to three lines until clicked. */
	.why {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		max-width: 320px;
		margin-top: 14px;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 13px;
		line-height: 18px;
		text-align: left;
		color: #3d3d3a;
		cursor: pointer;
	}
	.why.open {
		-webkit-line-clamp: unset;
		line-clamp: unset;
		cursor: auto;
	}
	.why span {
		color: #7b7a74;
	}
	.metrics b {
		display: block;
		color: #0b0b0b;
		font-size: 24px;
		line-height: 32px;
		font-variant-numeric: tabular-nums;
	}
</style>
