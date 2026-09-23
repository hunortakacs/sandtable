<script lang="ts">
	import { espConnected, fan } from './stores';
	import { sendFanValue } from './websocket';
	import { createEchoGate, createThrottledSender } from './liveControl';

	const sender = createThrottledSender(sendFanValue);
	const echo = createEchoGate();

	let sliding = false;
	let localValue = 0;

	// Follow the machine only while it isn't us driving it — see createEchoGate.
	$: if (!sliding && echo.accepts($fan)) {
		localValue = $fan;
	}
	$: fanPercentage = Math.round((localValue * 100) / 255);
	$: numberInput = fanPercentage;

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

	let fanIcon: HTMLElement;
	$: {
		if (fanIcon) {
			if (fanPercentage > 0) {
				const speed = `${30 / fanPercentage}s`;
				fanIcon.style.setProperty('--fan-speed', speed);
			} else {
				fanIcon.style.setProperty('--fan-speed', '0s');
			}
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
	<div class="w-10 aspect-square flex justify-center items-center">
		<i id="fanIcon" class="fa-solid fa-fan text-center text-2xl" bind:this={fanIcon}></i>
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

	#fanIcon {
		--fan-speed: 0s;
		animation-name: spin;
		animation-duration: var(--fan-speed);
		animation-iteration-count: infinite;
		animation-timing-function: linear;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
</style>
