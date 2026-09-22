<script lang="ts">
	import { currentFile, machinePatterns, machineStats, playbackMode } from './stores';
	import { sendSkip } from './websocket';

	// Same derivation Queue.svelte uses to detect a cleaner currently playing,
	// but not restricted to QUEUE mode since autoclean cleaners can also
	// interleave during SHUFFLE playback.
	$: cleanerPlaying =
		$playbackMode !== 0 &&
		$currentFile !== '' &&
		$machinePatterns.find((p) => p.filename === $currentFile)?.type === 1;
</script>

<button
	class="btn btn-square"
	aria-label={cleanerPlaying ? 'Skip Cleaner' : 'Skip Pattern'}
	title={cleanerPlaying ? 'Skip Cleaner' : 'Skip Pattern'}
	onclick={sendSkip}
	disabled={$machineStats.homing || $currentFile === ''}
>
	<i class="fa-solid fa-forward-step"></i>
</button>
