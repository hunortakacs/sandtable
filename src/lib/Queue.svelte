<script lang="ts">
	import {
		queue,
		queueIndex,
		playbackMode,
		autoclean,
		machineStats,
		machinePatterns,
		currentFile
	} from './stores';
	import {
		sendQueueMove,
		sendQueueRemove,
		sendQueueClear,
		sendPlayQueue,
		sendPlayShuffle,
		sendAutoclean
	} from './websocket';

	$: disabled = $machineStats.busy || (!$machineStats.homed && $machineStats.safemode);

	// The firmware plays cleaner patterns in between queue entries without adding
	// them to the queue itself, so we detect this by checking whether the file
	// currently playing on the machine is a cleaner-type pattern.
	$: cleanerPlaying =
		$playbackMode === 1 &&
		$currentFile !== '' &&
		$machinePatterns.find((p) => p.filename === $currentFile)?.type === 1;
</script>

<div class="flex flex-col p-4 gap-4 rounded-box bg-base-200 h-fit w-full max-w-md">
	<div class="flex justify-between items-center px-1 flex-wrap gap-2">
		<h2 class="text-lg font-bold">Queue</h2>
		<div class="flex gap-2">
			<button
				class="btn btn-sm {$playbackMode === 1 ? 'btn-primary' : 'btn-ghost'}"
				onclick={() => sendPlayQueue()}
				{disabled}
			>
				<i class="fa-solid fa-list-ol"></i> Queue
			</button>
			<button
				class="btn btn-sm {$playbackMode === 2 ? 'btn-primary' : 'btn-ghost'}"
				onclick={() => sendPlayShuffle()}
				{disabled}
			>
				<i class="fa-solid fa-shuffle"></i> Shuffle
			</button>
		</div>
	</div>

	<div class="flex justify-between items-center px-1 flex-wrap gap-2">
		<label class="cursor-pointer label gap-2 p-0">
			<span class="label-text font-semibold">Auto-Clean</span>
			<input
				type="checkbox"
				class="toggle toggle-primary toggle-sm"
				checked={$autoclean}
				onchange={(e) => sendAutoclean(e.currentTarget.checked)}
			/>
		</label>
		<button class="btn btn-sm btn-error btn-outline" onclick={() => sendQueueClear()}>
			Clear All
		</button>
	</div>

	<div class="flex flex-col gap-2 max-h-96 overflow-y-auto pr-1">
		{#if $queue.length === 0}
			<div class="py-4 text-center opacity-50 italic text-sm">Queue is empty</div>
		{:else}
			{#each $queue as qItem, i}
				<div
					class="flex gap-2 items-center p-2 rounded-lg {i === $queueIndex &&
					$playbackMode === 1 &&
					!cleanerPlaying
						? 'bg-primary text-primary-content'
						: 'bg-base-100'}"
				>
					<span class="font-mono text-xs w-5 text-right opacity-70">{i + 1}.</span>
					<p class="font-bold flex-1 truncate text-sm">{qItem.replace('.bin', '')}</p>
					<div class="flex gap-1">
						<button
							class="btn btn-xs btn-square btn-ghost"
							onclick={() => sendQueueMove(i, i - 1)}
							disabled={i === 0}
						>
							<i class="fa-solid fa-arrow-up"></i>
						</button>
						<button
							class="btn btn-xs btn-square btn-ghost"
							onclick={() => sendQueueMove(i, i + 1)}
							disabled={i === $queue.length - 1}
						>
							<i class="fa-solid fa-arrow-down"></i>
						</button>
						<button
							class="btn btn-xs btn-square btn-ghost hover:bg-error hover:text-error-content"
							onclick={() => sendQueueRemove(i)}
							disabled={i === $queueIndex && $playbackMode === 1}
						>
							<i class="fa-solid fa-xmark"></i>
						</button>
					</div>
				</div>

				{#if cleanerPlaying && i === $queueIndex}
					<div
						class="flex gap-2 items-center p-2 rounded-lg border-2 border-dashed border-accent bg-accent/10"
					>
						<span class="font-mono text-xs w-5 text-center opacity-70">
							<i class="fa-solid fa-broom"></i>
						</span>
						<div class="flex flex-col flex-1 min-w-0">
							<p class="font-bold italic truncate text-sm">
								{$currentFile.replace('/', '').replace('.bin', '')}
							</p>
							<span class="badge badge-xs badge-accent mt-1 w-fit">Cleaner</span>
						</div>
						<i class="fa-solid fa-spinner fa-spin text-accent"></i>
					</div>
				{/if}
			{/each}
		{/if}
	</div>
</div>
