<script lang="ts">
	import { currentFile, espConnected, machineStats, selectedPattern, armedPlaybackMode } from './stores';
	import { sendPause, sendResume, sendStart, sendPlayQueue, sendPlayShuffle } from './websocket';

	function resumePauseToggleButton() {
		if ($machineStats.executing) sendPause();
		else if ($currentFile !== '') sendResume();
		else if ($selectedPattern !== '') sendStart($selectedPattern);
		// Nothing loaded and no library pattern picked — start whichever
		// operating mode (Queue/Shuffle) is currently armed.
		else if ($armedPlaybackMode === 2) sendPlayShuffle();
		else sendPlayQueue();
	}
</script>

<button
	class="btn btn-square"
	aria-label={$machineStats.executing ? 'Pause' : 'Play'}
	onclick={resumePauseToggleButton}
	disabled={!$espConnected || $machineStats.homing}
>
	<i class="fa-solid {$machineStats.executing ? 'fa-pause' : 'fa-play'}"></i>
</button>
