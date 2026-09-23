<script lang="ts">
	import { currentFile, espConnected, machineStats } from './stores';
	import { sendPrevious } from './websocket';
</script>

<button
	class="btn btn-square"
	aria-label="Previous"
	title="Previous"
	onclick={sendPrevious}
	disabled={!$espConnected || $machineStats.homing || $currentFile === ''}
>
	<i class="fa-solid fa-backward-step"></i>
</button>
