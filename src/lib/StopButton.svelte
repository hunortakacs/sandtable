<script>
	import { espConnected } from './stores';
	import { sendStop } from './websocket';
</script>

<button
	class="btn btn-square"
	aria-label="Stop"
	onclick={sendStop}
	disabled={!$espConnected}
>
	<i class="fa-solid fa-stop"></i>
</button>
