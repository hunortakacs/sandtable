<script lang="ts">
	import { currentFile, machineStats } from './stores';
	import { sendPrevious } from './websocket';
</script>

<button
	class="btn btn-square"
	aria-label="Previous"
	title="Previous"
	onclick={sendPrevious}
	disabled={$machineStats.homing || $currentFile === ''}
>
	<i class="fa-solid fa-backward-step"></i>
</button>
