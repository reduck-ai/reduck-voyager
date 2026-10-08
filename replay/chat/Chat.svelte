<!--
	A chat as Claude Code shows it, frozen at `t` ms after it started: the ask as a bubble, then
	what the assistant said and did up to that moment. Consecutive tool calls fold into one muted
	line, as on claude.ai/code; a call whose result has not come back by `t` pulses. When the
	chat's tools return screenshots, the latest one is a picture in picture at the bottom right:
	the browser at that moment. With `onexpand`, a click on it asks the page to show it larger;
	while `expanded`, it leaves the corner (see Screen.svelte for how it travels).

	It holds no clock. Leave `t` out for the whole chat; bind it to a Timeline to play it, and
	give several chats the same `t` to play them together. It fills its parent, which must give
	it a height.
-->
<script lang="ts">
	import { marked } from "marked";
	import { label, readable, rowsAt, running, screenAt, type Chat } from "./chat.ts";
	import Screen, { receive, send } from "./Screen.svelte";

	let {
		chat,
		t = Infinity,
		expanded = false,
		onexpand
	}: { chat: Chat; t?: number; expanded?: boolean; onexpand?: () => void } = $props();

	const rows = $derived(rowsAt(chat, t));
	const screen = $derived(screenAt(chat, t));
	const done = $derived(t >= chat.durationMs);

	let open = $state(new Set<string>());
	const toggle = (key: string) => {
		const next = new Set(open);
		if (!next.delete(key)) next.add(key);
		open = next;
	};

	let scroller: HTMLElement;
	/** The newest line is at the bottom, so the chat follows it as the run goes on. Until the
	 *  assistant has said anything there is nothing to follow and the ask is the whole chat:
	 *  it stays at its top, so a long ask is read from its first line rather than its last. */
	$effect(() => {
		if (!rows.length) return;
		scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
	});
</script>

<div class="chat">
	<div class="scroller" bind:this={scroller}>
		<div class="column">
			<div class="human">{chat.ask}</div>
			{#each rows as row, i (i)}
				{#if row.kind === "text"}
					<div class="text">{@html marked.parse(row.step.text)}</div>
				{:else}
					{@const key = row.steps[0].at}
					{@const last = row.steps.at(-1)!}
					<button class="tools" onclick={() => toggle(key)}>
						<span class:live={running(chat, last, t)}>{label(last)}</span>
						{#if row.steps.length > 1}<span>· {row.steps.length} calls</span>{/if}
						<span class="chevron" class:down={open.has(key)}>›</span>
					</button>
					{#if open.has(key)}
						<div class="calls">
							{#each row.steps as step, j (j)}
								{@const callKey = `${key}/${j}`}
								<button class="call" class:error={step.error} onclick={() => toggle(callKey)}>
									{label(step)}
									<span class="chevron" class:down={open.has(callKey)}>›</span>
								</button>
								{#if open.has(callKey)}
									<pre>{JSON.stringify(step.input, null, 2)}</pre>
									{#if !running(chat, step, t)}
										<pre class="result">{readable(step.result)}</pre>
										{#each step.images as image}
											<img src="data:{image.mediaType};base64,{image.data}" alt="" />
										{/each}
									{/if}
								{/if}
							{/each}
						</div>
					{/if}
				{/if}
			{/each}
			{#if !done}<div class="spark">✳</div>{/if}
		</div>
	</div>
	{#if screen && !expanded}
		<button
			class="pip"
			disabled={!onexpand}
			onclick={onexpand}
			in:receive={{ key: chat }}
			out:send={{ key: chat }}
		>
			<Screen {screen} />
		</button>
	{/if}
</div>

<style>
	.chat {
		position: relative;
		height: 100%;
		background: #fcfcfb;
		color: #0b0b0b;
		font: 14px/20px anthropic-sans, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
	}
	.scroller {
		height: 100%;
		overflow-y: auto;
	}
	/* The bottom padding keeps the newest line clear of the picture in picture. */
	.column {
		max-width: 768px;
		margin: 0 auto;
		padding: 24px 32px 232px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.human {
		align-self: flex-end;
		max-width: 85%;
		padding: 8px 12px;
		border-radius: 10px;
		background: rgb(11 11 11 / 0.05);
		line-height: 18px;
		white-space: pre-wrap;
	}
	.text :global(:is(p, ul, ol, pre)) {
		margin: 0 0 8px;
	}
	.text :global(:not(pre) > code) {
		font: 0.9em anthropic-mono, ui-monospace, "SF Mono", monospace;
		color: rgb(142 38 38);
		background: rgb(11 11 11 / 0.05);
		border-radius: 5px;
		padding: 1px 3px;
	}
	button {
		all: unset;
		cursor: pointer;
	}
	.tools,
	.call {
		color: #7b7a74;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tools {
		align-self: flex-start;
		max-width: 100%;
	}
	.tools:hover,
	.call:hover {
		color: #3d3d3a;
	}
	.live,
	.spark {
		animation: pulse 1.2s ease-in-out infinite;
	}
	.chevron {
		display: inline-block;
		margin-left: 4px;
		transition: transform 0.15s;
	}
	.chevron.down {
		transform: rotate(90deg);
	}
	.calls {
		display: flex;
		flex-direction: column;
		border: 1px solid rgb(11 11 11 / 0.1);
		border-radius: 8px;
		overflow: hidden;
	}
	.call {
		padding: 8px 10px;
		border-top: 1px solid rgb(11 11 11 / 0.1);
	}
	.call:first-child {
		border-top: 0;
	}
	.call.error {
		color: rgb(180 50 40);
	}
	pre {
		margin: 0 10px 8px;
		padding: 8px;
		max-height: 240px;
		overflow: auto;
		border: 1px solid rgb(11 11 11 / 0.1);
		border-radius: 6px;
		font: 12px/16px anthropic-mono, ui-monospace, "SF Mono", monospace;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.result {
		color: #3d3d3a;
	}
	.calls img {
		margin: 0 10px 8px;
		max-width: calc(100% - 20px);
		border-radius: 6px;
		border: 1px solid rgb(11 11 11 / 0.1);
	}
	.spark {
		color: #d97757;
		font-size: 18px;
	}
	.pip {
		position: absolute;
		right: 16px;
		bottom: 16px;
		width: 320px;
		height: 200px;
		overflow: hidden;
		border-radius: 10px;
		background: #e9e8e2;
		box-shadow: 0 6px 24px rgb(11 11 11 / 0.18);
		cursor: zoom-in;
	}
	.pip:disabled {
		cursor: default;
	}
	@keyframes pulse {
		50% {
			opacity: 0.4;
		}
	}
</style>
