<script lang="ts">
	import { espConnected, led } from './stores';
	import { sendLedValue } from './websocket';
	import { createEchoGate, createThrottledSender } from './liveControl';

	const sender = createThrottledSender(sendLedValue);
	const echo = createEchoGate();

	let sliding = false;
	let localValue = 0;

	// Follow the machine only while it isn't us driving it — see createEchoGate.
	$: if (!sliding && echo.accepts($led)) {
		localValue = $led;
	}
	$: ledPercentage = Math.round((localValue * 100) / 255);
	$: numberInput = ledPercentage;

	function emit(value: number, final: boolean) {
		echo.sent(value);
		if (final) sender.commit(value);
		else sender.push(value);
	}

	function convertAndSend() {
		if (numberInput > 100) return;
		const value = Math.floor((numberInput * 255) / 100);
		localValue = value;
		emit(value, true);
	}

	function slideInput() {
		sliding = true;
		emit(localValue, false);
	}

	function slideEnd() {
		sliding = false;
		emit(localValue, true);
	}

	let glow: HTMLDivElement;
	$: {
		if (glow) {
			glow.style.boxShadow =
				ledPercentage == 0
					? ''
					: `0 0 ${ledPercentage / 20 + 6}px ${ledPercentage / 20 + 6}px #fff,
					   0 0 ${(ledPercentage / 20) * 2 + 6}px ${ledPercentage / 20 + 6}px #ffcc00`;
		}
	}
</script>

<div class="flex justify-center gap-2 items-center">
	<input
		type="range"
		min="0"
		max="255"
		step="1"
		bind:value={localValue}
		class="range range-sm"
		oninput={slideInput}
		onchange={slideEnd}
		disabled={!$espConnected}
	/>
	<div class="w-10 aspect-square flex justify-center items-center relative">
		<div class="absolute top-[9px] rounded-full" bind:this={glow}></div>
		<i class="fa-solid fa-lightbulb text-2xl text-center"></i>
	</div>
	<form class="contents" onsubmit={convertAndSend}>
		<input
			type="number"
			min="0"
			max="100"
			class="badge min-w-14 text-center"
			bind:value={numberInput}
			disabled={!$espConnected}
		/>
	</form>
</div>

<style>
	input[type='number']::-webkit-inner-spin-button,
	input[type='number']::-webkit-outer-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
</style>
