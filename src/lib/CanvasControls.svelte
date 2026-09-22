<script lang="ts">
	import {
		sendingPattern,
		uploadError,
		sentPacketCount,
		totalPacketCount,
		currentFile,
		patternProgress
	} from './stores';
	import { sendCancelUpload, sendPatternFragments } from './websocket';

	export let patterns: string[];
	export let canvasComponent: any;
	export let pointNums: number[];

	let patternName = 'pattern';
	let isCleaner = false;
	let useCenteredBounds = true;
	let patternSelector: HTMLSelectElement;

	function reset() {
		if (canvasComponent) canvasComponent.clear();
		patternSelector.selectedIndex = 0;
		patternName = 'pattern';
	}

	// `fromDevice`: true when this load is following the ESP's own currentFile
	// report (as opposed to the user manually browsing/authoring a pattern) —
	// draws the whole shape as a faint background plus whatever's already
	// been traversed (per patternProgress) instead of the animated full
	// preview, and survives a page reload since it's re-derived fresh each time.
	async function handlePatternChange(fromDevice = false) {
		let selected = patternSelector.value;
		if (!selected) return;

		if (!fromDevice) patternName = selected.replace('.gcode', '');

		try {
			const response = await fetch(`/patterns/${selected}`);
			if (response.ok) {
				const content = await response.text();
				if (canvasComponent) {
					if (fromDevice) {
						canvasComponent.loadDevicePattern(content.split('\n'), $patternProgress);
					} else {
						canvasComponent.processLines(content.split('\n'));
					}
				}
			}
		} catch (error) {
			console.error("Couldn't fetch pattern from files.");
		}
	}

	function handleFileChange(event: any) {
		const selectedFile = event.target.files[0];
		if (!selectedFile) return;

		patternName = selectedFile.name.replace('.gcode', '');

		const reader = new FileReader();
		reader.onloadend = () => {
			if (reader.result) {
				if (canvasComponent) canvasComponent.processLines(reader.result.toString().split('\n'));
			}
		};
		reader.readAsText(selectedFile);
	}

	function toggleBoundsMode() {
		useCenteredBounds = !useCenteredBounds;
		if (canvasComponent) {
			canvasComponent.setCenteredBounds(useCenteredBounds);
			canvasComponent.recalculate();
		}
	}

	currentFile.subscribe(($currentFile) => {
		if (!$currentFile) {
			if (canvasComponent) canvasComponent.clear();
			return;
		}
		patternName = $currentFile.replace('/', '').replace('.bin', '');

		if (!patternSelector) return;
		const mapped = $currentFile.replace('.bin', '.gcode');
		const exists = Array.from(patternSelector.options).some((opt) => opt.value === mapped);
		if (exists) {
			patternSelector.value = mapped;
			handlePatternChange(true);
		}
	});
</script>

<div class="flex flex-col gap-4 bg-neutral p-4 rounded-box w-full max-w-md">
	<h2 class="text-lg font-bold px-1 text-neutral-content">Pattern Editor</h2>

	<div class="flex flex-col gap-3">
		<input
			type="text"
			class="input input-bordered w-full font-bold"
			placeholder="Pattern Name"
			bind:value={patternName}
		/>

		<div class="flex gap-2 w-full flex-wrap">
			<button class="btn flex-1" onclick={reset} aria-label="clear">
				<i class="fa-solid fa-eraser"></i> Clear
			</button>

			<input id="gcode" type="file" accept=".gcode" class="hidden" onchange={handleFileChange} />
			<label for="gcode" class="btn flex-1">
				<i class="fa-solid fa-upload"></i> Upload
			</label>
		</div>

		<select
			bind:this={patternSelector}
			class="select select-bordered w-full font-semibold"
			onchange={() => handlePatternChange()}
			onfocus={() => {
				patternSelector.selectedIndex = 0;
			}}
		>
			<option value="" disabled selected>Load Built-in Pattern...</option>
			{#each patterns as pattern}
				<option value={pattern}>{pattern.replace('.gcode', '')}</option>
			{/each}
		</select>

		<div class="flex gap-2 w-full">
			<button
				class="btn flex-1"
				onclick={() => canvasComponent?.triggerPreview(1)}
				aria-label="preview"
				disabled={pointNums.length === 0}
			>
				<i class="fa-solid fa-eye"></i> Preview
			</button>
			<button
				class="btn flex-1"
				onclick={toggleBoundsMode}
				title={useCenteredBounds ? 'Centered mode' : 'Keep origin mode'}
			>
				<i class="fa-solid {useCenteredBounds ? 'fa-compress' : 'fa-expand'}"></i>
				{useCenteredBounds ? 'Cnt' : 'Org'}
			</button>
		</div>

		<div class="divider my-0"></div>

		{#if $uploadError}
			<div class="alert alert-error text-sm py-2">
				<i class="fa-solid fa-triangle-exclamation"></i>
				<span>{$uploadError}</span>
			</div>
		{/if}

		{#if $sendingPattern}
			<div class="flex gap-2 w-full">
				<button class="btn btn-primary flex-1" aria-label="sending progress" disabled>
					<span class="loading loading-spinner"></span>
					{$sentPacketCount} / {$totalPacketCount}
				</button>
				<button class="btn btn-error" onclick={sendCancelUpload}>
					<i class="fa-solid fa-xmark"></i>
				</button>
			</div>
		{:else}
			<div class="flex gap-2 w-full items-center">
				<label
					class="cursor-pointer label gap-2 bg-base-100 px-4 py-3 rounded-lg flex-1 border border-base-300"
				>
					<span class="label-text font-bold">Is Cleaner</span>
					<input type="checkbox" class="checkbox checkbox-primary" bind:checked={isCleaner} />
				</label>
				<button
					class="btn btn-primary flex-1"
					onclick={() => sendPatternFragments(pointNums, patternName, isCleaner)}
					disabled={!patternName || pointNums.length === 0}
				>
					<i class="fa-solid fa-paper-plane"></i> Send
				</button>
			</div>
		{/if}
	</div>
</div>
