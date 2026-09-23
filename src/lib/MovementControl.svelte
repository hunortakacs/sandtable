<script lang="ts">
	import { espConnected, machineStats } from '$lib/stores';
	import { sendHome, sendMove } from './websocket';

	// With the ESP gone, everything below is a command nobody will receive and
	// a machine state we can no longer vouch for — so nothing here is operable.
	$: disabled =
		!$espConnected ||
		$machineStats.homing ||
		$machineStats.executing ||
		(!$machineStats.homed && $machineStats.safemode);

	let unit = 10;
</script>

<div class="grid grid-cols-3 grid-rows-3 gap-1 w-fit select-none tooltip-bottom lg:tooltip-left">
	<button
		class="btn btn-square row-start-2 col-start-2"
		aria-label="home"
		onclick={() => sendHome()}
	>
		{#if $machineStats.homing}
			<span class="loading loading-spinner"></span>
		{:else}
			<i
				class="fa-solid {$machineStats.homed
					? 'fa-house-circle-check'
					: 'fa-house-circle-exclamation text-warning'} text-xl"
			></i>
		{/if}
	</button>
	<button
		class="btn rounded-t-badge row-start-1 col-start-2"
		aria-label="up"
		onclick={() => sendMove(0, unit)}
		{disabled}
	>
		<i class="fa-solid fa-angle-up text-lg"></i>
	</button>
	<button
		class="btn btn-sm btn-square rounded-r-badge rounded-tl-badge row-start-1 col-start-3 self-end"
		aria-label="upright"
		onclick={() => sendMove(unit, unit)}
		{disabled}
	>
		<i class="fa-solid fa-angle-up rotate-45"></i>
	</button>
	<button
		class="btn btn-square rounded-r-badge row-start-2 col-start-3"
		aria-label="right"
		onclick={() => sendMove(unit, 0)}
		{disabled}
	>
		<i class="fa-solid fa-angle-right text-lg"></i>
	</button>
	<button
		class="btn btn-sm btn-square rounded-b-badge rounded-tr-badge row-start-3 col-start-3"
		aria-label="downright"
		onclick={() => sendMove(unit, -unit)}
		{disabled}
	>
		<i class="fa-solid fa-angle-right rotate-45"></i>
	</button>
	<button
		class="btn btn-square rounded-b-badge row-start-3 col-start-2"
		aria-label="down"
		onclick={() => sendMove(0, -unit)}
		{disabled}
	>
		<i class="fa-solid fa-angle-down text-lg"></i>
	</button>
	<button
		class="btn btn-sm btn-square rounded-l-badge rounded-br-badge row-start-3 col-start-1 justify-self-end"
		aria-label="downleft"
		onclick={() => sendMove(-unit, -unit)}
		{disabled}
	>
		<i class="fa-solid fa-angle-down rotate-45"></i>
	</button>
	<button
		class="btn btn-square rounded-l-badge row-start-2 col-start-1"
		aria-label="left"
		onclick={() => sendMove(-unit, 0)}
		{disabled}
	>
		<i class="fa-solid fa-angle-left text-lg"></i>
	</button>
	<button
		class="btn btn-sm btn-square rounded-t-badge rounded-bl-badge row-start-1 col-start-1 self-end justify-self-end"
		aria-label="upleft"
		onclick={() => sendMove(-unit, unit)}
		{disabled}
	>
		<i class="fa-solid fa-angle-left rotate-45"></i>
	</button>
</div>
