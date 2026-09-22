<script lang="ts">
	import { currentFile, machinePatterns, machineStats, playbackMode, selectedPattern } from './stores';
	import { sendDeletePattern, sendPause, sendResume, sendQueueInsert } from './websocket';

	// 1. Add toggle state
	let showCleaner = true;

	// 2. Filter the patterns reactively
	$: filteredPatterns = showCleaner
		? $machinePatterns
		: $machinePatterns.filter((p) => p.type !== 1);

	$: disabled = $machineStats.busy || (!$machineStats.homed && $machineStats.safemode);

	// If the selected pattern gets deleted out from under us, drop the selection.
	$: if ($selectedPattern && !$machinePatterns.some((p) => p.filename === $selectedPattern)) {
		selectedPattern.set('');
	}
</script>

{#if $machinePatterns.length > 0}
	<div class="flex flex-col p-4 gap-4 rounded-box bg-base-200 h-fit w-full max-w-md">
		<div class="flex justify-between items-center">
			<h2 class="text-lg font-bold px-1">Library on ESP</h2>
			<label class="flex items-center gap-2 cursor-pointer text-xs font-medium">
				Show Cleaners
				<input
					type="checkbox"
					class="checkbox checkbox-xs checkbox-primary"
					bind:checked={showCleaner}
				/>
			</label>
		</div>

		<div class="flex flex-col gap-2 max-h-96 overflow-y-auto pr-1">
			{#each filteredPatterns as pattern}
				<div
					class="flex gap-2 items-center bg-base-100 p-2 rounded-lg"
					class:ring-2={pattern.filename === $selectedPattern}
					class:ring-primary={pattern.filename === $selectedPattern}
				>
					{#if pattern.filename == $currentFile && $playbackMode === 0}
						<button
							class="btn btn-sm btn-square btn-primary"
							aria-label="start"
							onclick={() => ($machineStats.executing ? sendPause() : sendResume())}
						>
							<i class="fa-solid {$machineStats.executing ? 'fa-pause' : 'fa-play'}"></i>
						</button>
					{:else}
						<button
							class="btn btn-sm btn-square btn-ghost"
							aria-label="select"
							title="Select for manual play"
							onclick={() => selectedPattern.set(pattern.filename)}
						>
							<i
								class="fa-solid {pattern.filename === $selectedPattern
									? 'fa-circle-check'
									: 'fa-regular fa-circle'}"
							></i>
						</button>
					{/if}

					<div class="flex flex-col flex-1 min-w-0">
						<p class="truncate text-sm" class:font-bold={pattern.filename == $currentFile}>
							{pattern.filename.replace('/', '').replace('.bin', '')}
						</p>
						{#if pattern.type === 1}
							<span class="badge badge-xs badge-accent mt-1">Cleaner</span>
						{/if}
					</div>

					<button
						class="btn btn-sm btn-square btn-secondary"
						title="Add to Queue"
						aria-label="add to queue"
						onclick={() => sendQueueInsert(pattern.filename, 0xffff)}
					>
						<i class="fa-solid fa-plus"></i>
					</button>

					<button
						class="btn btn-sm btn-square btn-ghost hover:bg-error hover:text-error-content"
						aria-label="delete"
						onclick={() => sendDeletePattern(pattern.filename)}
					>
						<i class="fa-solid fa-trash"></i>
					</button>
				</div>
			{/each}
		</div>
	</div>
{/if}
