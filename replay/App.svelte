<!--
	The route. `?run=<ref>&run=<ref>` compares those runs; without one, every task with its results.
	A ref is a run id, or `<id>@<stage>` to pin that lane to a stage, so `?run=<id>@raw&run=<id>@draft`
	puts a run's transcript next to its draft on one timeline. `&stage=` is the stage of the page
	and of every bare id; `&t=` opens the replay at a moment: `m:ss` as the timeline shows it,
	seconds, or `end`; `&speed=` is the rate it opens at and `&play` starts it there. The address
	is the whole state, so a view is a link, and a page that embeds the replay needs no script of
	its own to drive it.

	Only `pnpm replay` has stages other than published: its server reads any of them, and a switch
	changes the stage in place, keeping the moment. The built site holds the published files alone
	and a static host ignores a query, so there the page never sends one, and it refuses a ref at
	another stage rather than show the published file under that stage's name.
-->
<script lang="ts">
	import Compare from "./Compare.svelte";
	import Home from "./Home.svelte";
	import Stages from "./Stages.svelte";
	import type { RunWithSession, Stage, TaskTrials } from "./run.ts";

	const DEV = import.meta.env.DEV;

	let params = $state(new URLSearchParams(location.search));
	const stage = $derived((DEV ? (params.get("stage") ?? "raw") : "published") as Stage);
	const refs = $derived(
		params.getAll("run").map((ref) => {
			const [id, at = stage] = ref.split("@");
			return { id, stage: at as Stage };
		})
	);

	/** Where the replay opens, how fast, and whether it is already running; from then on the
	 *  timeline owns all three. */
	const opened = new URLSearchParams(location.search);
	const start = opened.get("t") ?? "0";
	let t = $state(
		start === "end"
			? Infinity
			: start.split(":").reduce((s, part) => s * 60 + Number(part), 0) * 1000 || 0
	);
	const speed = Number(opened.get("speed")) || undefined;
	const autoplay = opened.has("play");

	/** Changes the address in place: no reload, and the view follows. */
	function go(changes: Record<string, string>) {
		const next = new URLSearchParams(params);
		for (const [key, value] of Object.entries(changes)) next.set(key, value);
		history.replaceState(null, "", `?${next}`);
		params = next;
	}

	async function get(path: string, at: Stage) {
		if (!DEV && at !== "published")
			throw new Error(`"${path}@${at}" is not on the public site: only published runs are.`);
		const r = await fetch(DEV ? `data/${path}.json?stage=${at}` : `data/${path}.json`);
		if (!r.ok) throw new Error(await r.text());
		return r.json();
	}

	const tasks = $derived(get("tasks", stage) as Promise<TaskTrials[]>);
	const runs = $derived(
		Promise.all(
			refs.map(async (ref) => ({ ...((await get(ref.id, ref.stage)) as RunWithSession), stage: ref.stage }))
		)
	);
</script>

{#if DEV}<Stages {stage} pick={(s) => go({ stage: s })} />{/if}

{#if refs.length}
	{#await Promise.all([tasks, runs]) then [tasks, runs]}
		<Compare
			{runs}
			bind:t
			{speed}
			{autoplay}
			task={tasks.find((task) => task.id === runs[0].task)}
		/>
	{:catch error}
		<p>{error.message}</p>
	{/await}
{:else}
	{#await tasks then tasks}
		<Home {tasks} stage={DEV ? stage : undefined} />
	{:catch error}
		<p>{error.message}</p>
	{/await}
{/if}

<style>
	/* Reduck's palette (app/src/lib/styles/colorPalette.css), on a warm light page. Text is
	   grey-900, never pure black; the brand orange is the one accent. Where the two tools are
	   told apart, Reduck takes the orange and Chrome the ink. The brand orange itself is too
	   light to read on white (2.9:1), so marks take orange-600 (3.6:1, over the 3:1 a graphic
	   needs) and text orange-700 (5.2:1, over the 4.5:1 text needs). */
	:global(:root) {
		--ink: #111827;
		--ink-2: #4b5563;
		--ink-3: #6b7280;
		--line: rgb(17 24 39 / 0.1);
		--surface: #fcfcfb;
		--brand: #f37321;
		--pass: #16a34a;
		--fail: #dc2626;
		--brand-text: #c2410c;
		--reduck: #ea580c;
		--chrome: var(--ink);
	}
	:global(body) {
		margin: 0;
		background: var(--surface);
		color: var(--ink);
		font: 14px/20px Inter, system-ui, sans-serif;
		font-optical-sizing: auto;
	}
	p {
		padding: 24px 32px;
	}
</style>
