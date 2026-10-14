<!--
	The pages the runs' searches returned, side by side: one column per run, headed by what its
	searches typed, and one row per page any of them returned or cited. A cell is where that run
	had the page: its search call and rank (`c2 #5`), bold with a dot when the answer cited it, empty
	when the run never had it. A run that does not show its searches (ChatGPT signed out) has
	only its citations, so an empty cell there means "not cited", not "not returned": its header
	says so. Rows are ordered by how many runs had the page, then by its best rank; a page of
	`OURS` is marked, nothing is hidden.
-->
<script lang="ts">
	import { armName, hostOf, OURS, pageKey, type Page, type RunWithSession } from "./run.ts";

	let { runs }: { runs: (RunWithSession & { stage: string })[] } = $props();

	/** Each run's place for a page: its first occurrence, in call then rank order. */
	const at = (pages: Page[]) => {
		const m = new Map<string, Page>();
		for (const p of [...pages].sort((a, b) => (a.call ?? 99) - (b.call ?? 99) || (a.rank ?? 99) - (b.rank ?? 99)))
			if (!m.has(pageKey(p.url))) m.set(pageKey(p.url), p);
		return m;
	};
	const columns = $derived(
		runs.map((run) => {
			const pages = run.pages ?? [];
			// What its rounds typed, each once: a round's queries are shared by all its calls.
			const typed = [...new Set(pages.flatMap((p) => (p.queries ? [p.queries.join(" · ")] : [])))];
			return {
				run,
				where: at(pages),
				typed,
				shown: pages.some((p) => p.queries),
				cited: pages.filter((p) => p.cited).length,
				total: new Set(pages.map((p) => pageKey(p.url))).size
			};
		})
	);
	const rows = $derived.by(() => {
		const keys = new Map<string, Page>();
		for (const c of columns) for (const [k, p] of c.where) if (!keys.has(k)) keys.set(k, p);
		return [...keys]
			.map(([key, page]) => {
				const cells = columns.map((c) => c.where.get(key) ?? null);
				const had = cells.filter(Boolean) as Page[];
				return {
					key,
					page,
					cells,
					count: had.length,
					best: Math.min(...had.map((p) => p.rank ?? 99)),
					ours: hostOf(page.url) === OURS || hostOf(page.url).endsWith(`.${OURS}`)
				};
			})
			.sort((a, b) => b.count - a.count || a.best - b.best);
	});
	const cell = (p: Page) =>
		p.call === null ? "cited" : `c${p.call} ${p.rank === null ? p.type : `#${p.rank}`}`;
</script>

<div class="pages">
	<table>
		<thead>
			<tr>
				<th class="page">{rows.length} pages</th>
				{#each columns as c (c.run.id + c.run.stage)}
					<th>
						<strong>{armName(c.run.arm)}</strong>
						<span class="trial">{c.run.id.split("/")[0].slice(0, 16).replace("T", " ")}</span>
						<span class="sum">{c.total} pages · {c.cited} cited</span>
						{#if !c.shown}<span class="note">searches not shown: citations only</span>{/if}
						<ol>
							{#each c.typed as queries}<li>{queries}</li>{/each}
						</ol>
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as row (row.key)}
				<tr class:ours={row.ours}>
					<td class="page">
						<a href={row.page.url} target="_blank" rel="noreferrer">{hostOf(row.page.url)}</a>
						<span class="title">{row.page.title ?? row.key}</span>
					</td>
					{#each row.cells as p}
						<td class:cited={p?.cited} title={p?.queries?.join(" · ") ?? ""}>
							{#if p}{cell(p)}{#if p.cited} ●{/if}{/if}
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.pages {
		overflow: auto;
		background: #fcfcfb;
	}
	table {
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 6px 12px;
		border-bottom: 1px solid var(--line);
		text-align: left;
		vertical-align: top;
	}
	thead th {
		position: sticky;
		top: 0;
		z-index: 1;
		background: #f5f4ef;
		min-width: 200px;
		max-width: 280px;
		font-weight: 400;
	}
	th span {
		display: block;
		color: var(--ink-3);
		font-size: 12px;
	}
	.note {
		color: var(--fail);
	}
	ol {
		margin: 6px 0 0;
		padding-left: 18px;
		font-size: 12px;
		line-height: 16px;
		color: var(--ink-2);
	}
	.page {
		position: sticky;
		left: 0;
		background: inherit;
		min-width: 320px;
		max-width: 420px;
	}
	td.page {
		background: #fcfcfb;
	}
	.page a {
		color: var(--ink);
		font-weight: 600;
	}
	.title {
		display: block;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--ink-3);
		font-size: 12px;
	}
	td {
		white-space: nowrap;
		color: var(--ink-3);
	}
	td.cited {
		color: var(--ink);
		font-weight: 600;
	}
	tr.ours td {
		background: rgb(243 115 33 / 0.08);
	}
	tr.ours .page a {
		color: var(--brand);
	}
</style>
