<script lang="ts">
	import { espConnected, machineStats, position, socketState, playbackMode } from './stores';

	type socketStates = { [code: number]: { name: string; color: string; icon: string } };
	const states: socketStates = {
		0: { name: 'CONNECTING', color: 'text-info', icon: 'fa-circle-info' },
		1: { name: 'OPEN', color: 'text-success', icon: 'fa-link' },
		2: { name: 'CLOSING', color: 'text-warning', icon: 'fa-triangle-exlamation' },
		3: { name: 'CLOSED', color: 'text-error', icon: 'fa-link-slash' }
	};
	const unknownState = { name: 'UNKNOWN', color: 'text-error', icon: 'fa-link-slash' };
	$: socket = states[$socketState] ?? unknownState;
</script>

<div class="flex gap-2 flex-wrap justify-center">
	<div class="stats">
		<div class="stat">
			<div class="stat-title">Websocket</div>
			<div class="stat-value {socket.color} flex items-center gap-2">
				{socket.name}
				<i class="fa-solid {socket.icon} text-xl"></i>
			</div>
		</div>
	</div>
	<div class="stats">
		<div class="stat">
			<div class="stat-title">ESP32</div>
			<div
				class="stat-value {$espConnected ? 'text-success' : 'text-error'} flex items-center gap-2"
			>
				{$espConnected ? 'ONLINE' : 'OFFLINE'}
				<i class="fa-solid {$espConnected ? 'fa-link' : 'fa-link-slash'} text-xl"></i>
			</div>
		</div>
	</div>
	<div class="stats shadow">
		<div class="stat">
			<div class="stat-title">X position</div>
			<div class="stat-value">
				{$espConnected && $machineStats.homed ? Math.round($position.x) : '-'}
			</div>
			<div class="stat-desc">mm</div>
		</div>
	</div>
	<div class="stats shadow">
		<div class="stat">
			<div class="stat-title">Y position</div>
			<div class="stat-value">
				{$espConnected && $machineStats.homed ? Math.round($position.y) : '-'}
			</div>
			<div class="stat-desc">mm</div>
		</div>
	</div>
	<div class="stats shadow">
		<div class="stat">
			<div class="stat-title">State</div>
			<div class="stat-value">
				{#if !$espConnected}
					<span class="text-error">Offline</span>
				{:else if $machineStats.homing}
					Homing
				{:else if $machineStats.executing}
					Playing ({$playbackMode === 1 ? 'Queue' : $playbackMode === 2 ? 'Shuffle' : 'Manual'})
				{:else if $machineStats.busy}
					Busy
				{:else}
					Idle
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.stats {
		border: 1px solid oklch(var(--bc) / 0.2);
	}
</style>
