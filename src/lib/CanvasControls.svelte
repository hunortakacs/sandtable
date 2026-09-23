<script lang="ts">
	import {
		sendingPattern,
		uploadError,
		sentPacketCount,
		totalPacketCount,
		currentFile,
		espConnected
	} from './stores';
	import { sendCancelUpload, sendPatternFragments, requestPatternData } from './websocket';

	export let patterns: string[];
	export let canvasComponent: any;
	export let pointNums: number[];

	let patternName = 'pattern';
	let isCleaner = false;
	let useCenteredBounds = true;
	let patternSelector: HTMLSelectElement;

	// Which pattern's coordinates the canvas is currently showing, so the same
	// file being re-announced (reconnect, a fresh CURRENT_FILE request) doesn't
	// pull the whole thing down the wire again and reset the preview.
	let loadedFile = '';

	function reset() {
		loadedFile = '';
		if (canvasComponent) canvasComponent.clear();
		patternSelector.selectedIndex = 0;
		patternName = 'pattern';
	}

	async function handlePatternChange() {
		let selected = patternSelector.value;
		if (!selected) return;

		// The canvas is the editor's now; forget which device pattern was on it
		// so the live preview comes back the next time one is announced.
		loadedFile = '';
		patternName = selected.replace('.gcode', '');

		try {
			const response = await fetch(`/patterns/${selected}`);
			if (response.ok) {
				const content = await response.text();
				if (canvasComponent) canvasComponent.processLines(content.split('\n'));
			}
		} catch (error) {
			console.error("Couldn't fetch pattern from files.");
		}
	}

	// Redraws whatever the ESP reports as currently playing, from its own
	// compiled pattern data — the only source of truth for an uploaded/queued
	// pattern, which has no matching static .gcode asset on the frontend to
	// re-fetch by filename. Decodes the same 4-bytes-per-coordinate,
	// x100-scaled format the firmware reads from and the upload path writes
	// (see websocket.ts's sendPacket / file_handler.cpp's getNextCoordinate).
	// How far into it the machine has got is not fetched here — the canvas
	// tracks the firmware-reported coordinate index on its own.
	async function loadFromDevice(filename: string) {
		try {
			const raw = await requestPatternData(filename);
			if (raw.length === 0) {
				console.error(`Device has no data for ${filename}`);
				return;
			}
			const numPoints = Math.floor(raw.length / 2);
			const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
			const nums: number[] = new Array(numPoints);
			for (let i = 0; i < numPoints; i++) nums[i] = view.getUint16(i * 2) / 100;
			if (canvasComponent) canvasComponent.loadDeviceCoordinates(nums);
			loadedFile = filename;
		} catch (error) {
			loadedFile = '';
			console.error("Couldn't fetch the currently-playing pattern from the device.", error);
		}
	}

	function handleFileChange(event: any) {
		const selectedFile = event.target.files[0];
		if (!selectedFile) return;

		loadedFile = '';
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
			loadedFile = '';
			if (canvasComponent) canvasComponent.clear();
			return;
		}
		if ($currentFile === loadedFile) return;

		patternName = $currentFile.replace('/', '').replace('.bin', '');
		// Drop the outgoing pattern's geometry up front: the machine is already
		// reporting coordinate indices for the *new* one, and applying those to
		// the old shape would paint a trail along the wrong path until the
		// download lands.
		if (canvasComponent) canvasComponent.clear();
		loadFromDevice($currentFile);
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
				onclick={() => canvasComponent?.triggerPreview(true)}
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
					disabled={!$espConnected || !patternName || pointNums.length === 0}
				>
					<i class="fa-solid fa-paper-plane"></i> Send
				</button>
			</div>
		{/if}
	</div>
</div>
