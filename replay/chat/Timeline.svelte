<!--
	A clock from 0 to `duration` ms: play and pause (the button, or Space), scrub, and a speed.
	It only moves `t`; bind the same `t` to whatever it should drive. `marks` are moments drawn on
	the track, each with its label, such as when a run finished. `speed` is the rate it opens at
	and `autoplay` starts it there; from then on the buttons own both.
-->
<script lang="ts">
	import { faPause, faPlay } from "@fortawesome/free-solid-svg-icons";
	import { FontAwesomeIcon } from "@fortawesome/svelte-fontawesome";

	let {
		duration,
		t = $bindable(0),
		marks = [],
		speed: opening = 4,
		autoplay = false
	}: {
		duration: number;
		t?: number;
		marks?: { at: number; label: string }[];
		speed?: number;
		autoplay?: boolean;
	} = $props();

	// A rate with no button of its own would leave the row with nothing lit, so anything but one
	// of these falls back to the usual rate.
	// svelte-ignore state_referenced_locally
	let speed = $state(SPEEDS.includes(opening) ? opening : 4);
	// svelte-ignore state_referenced_locally
	let playing = $state(autoplay);

	$effect(() => {
		if (!playing) return;
		let last = performance.now();
		let frame = requestAnimationFrame(function tick(now) {
			t = Math.min(duration, t + (now - last) * speed);
			last = now;
			if (t < duration) frame = requestAnimationFrame(tick);
			else playing = false;
		});
		return () => cancelAnimationFrame(frame);
	});

	function toggle() {
		if (t >= duration) t = 0;
		playing = !playing;
	}

	/** Space plays and pauses from anywhere but a text field. Its default is prevented so that
	 *  it neither scrolls the page nor clicks whatever button has the focus. */
	function onkeydown(e: KeyboardEvent) {
		if (e.code !== "Space" || e.repeat) return;
		if ((e.target as HTMLElement).closest("textarea, [contenteditable], input:not([type=range])"))
			return;
		e.preventDefault();
		toggle();
	}
</script>

<script module lang="ts">
	export const SPEEDS = [1, 4, 16];

	export const clock = (ms: number) =>
		`${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
</script>

<svelte:window {onkeydown} />

<div class="timeline">
	<button class="play" onclick={toggle} aria-label={playing ? "Pause" : "Play"}>
		<!-- Two elements, not one with a changing `icon`: FontAwesomeIcon draws its icon once. -->
		{#if playing}<FontAwesomeIcon icon={faPause} />{:else}<FontAwesomeIcon icon={faPlay} />{/if}
	</button>
	<div class="track">
		<input type="range" min="0" max={duration} bind:value={t} />
		{#each marks as mark}
			<!-- The range's thumb is 16 px wide: its centre travels 8 px in from each end. -->
			<div
				class="mark"
				class:passed={t >= mark.at}
				style:left="calc(8px + (100% - 16px) * {mark.at / duration})"
			>
				<span>{mark.label} · {clock(mark.at)}</span>
			</div>
		{/each}
	</div>
	<span>{clock(t)} / {clock(duration)}</span>
	{#each SPEEDS as s}
		<button class:on={speed === s} onclick={() => (speed = s)}>{s}×</button>
	{/each}
</div>

<style>
	.timeline {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 16px 22px;
		font: 14px/20px anthropic-sans, system-ui, sans-serif;
		font-variant-numeric: tabular-nums;
	}
	.track {
		position: relative;
		flex: 1;
		display: flex;
	}
	input {
		flex: 1;
		margin: 0;
	}
	.mark {
		position: absolute;
		top: -4px;
		bottom: -4px;
		width: 2px;
		margin-left: -1px;
		background: #b5b3ab;
		pointer-events: none;
	}
	.mark span {
		position: absolute;
		top: 100%;
		right: 0;
		padding-top: 2px;
		font-size: 11px;
		line-height: 14px;
		white-space: nowrap;
		color: #7b7a74;
	}
	.mark.passed {
		background: #0b0b0b;
	}
	.mark.passed span {
		color: #0b0b0b;
	}
	button {
		padding: 4px 10px;
		border: 1px solid rgb(11 11 11 / 0.15);
		border-radius: 6px;
		background: white;
		cursor: pointer;
	}
	.play {
		width: 36px;
		height: 36px;
		padding: 0;
		display: grid;
		place-items: center;
		border-radius: 50%;
		border: 0;
		background: #0b0b0b;
		color: white;
	}
	button.on {
		background: #0b0b0b;
		color: white;
	}
</style>
