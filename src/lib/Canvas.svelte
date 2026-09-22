<script lang="ts">
	import { onMount } from 'svelte';
	import colors from 'tailwindcss/colors';
	import { machineStats, position, prevPosition } from './stores';
	const { orange } = colors;

	export let width = 490;
	export let height = 490;
	export let line = 8;

	export let pointNums: number[] = [];

	let maxWidth = width - line;
	let maxHeight = height - line;
	$: maxWidth = width - line;
	$: maxHeight = height - line;

	let useCenteredBounds = true;
	let lines: string[] = [];

	let canvas: HTMLCanvasElement;
	let bgCanvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null;
	let bgCtx: CanvasRenderingContext2D | null;
	let drawing = false;
	let preview = false;

	export function clear() {
		if (!ctx) return;
		preview = false;
		drawing = false;
		pointNums = [];
		lines = [];
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		bgCtx?.clearRect(0, 0, canvas.width, canvas.height);
	}

	// Loads the pattern the ESP reports as currently playing: the whole shape
	// is redrawn fresh on the faint background layer (a pure function of
	// pointNums, so it's safe to call again for the same pattern — e.g. on
	// every reconnect — unlike compositing/fading previous frames), and the
	// portion already traversed (per `progress`, a byte offset from the
	// firmware, 4 bytes/coordinate) is instantly filled in on the foreground
	// layer in the darker "already drawn" color. This is what makes progress
	// survive a page reload instead of starting the preview from scratch.
	export function loadDevicePattern(newLines: string[], progress: number) {
		lines = newLines;
		pointNums = parseGcode(lines);
		if (!ctx || !bgCtx || !canvas) return;

		ctx.clearRect(0, 0, canvas.width, canvas.height);
		bgCtx.clearRect(0, 0, canvas.width, canvas.height);
		for (let i = 0; i < pointNums.length - 2; i += 2) {
			draw(pointNums[i], pointNums[i + 1], pointNums[i + 2], pointNums[i + 3], orange[300], orange[200], bgCtx);
		}

		if (progress > 0) {
			drawUpTo(Math.floor(progress / 4) * 2);
		}
	}

	// Instantly (no animation) strokes pointNums[0..index] on the foreground
	// layer in the darker "already traversed" color — used both to fast-
	// forward a freshly (re)loaded pattern to wherever the machine has
	// actually already gotten to (e.g. after a page refresh), matching the
	// color live position ticks use for the same purpose.
	export function drawUpTo(index: number) {
		if (!ctx || pointNums.length < 4 || index <= 0) return;
		const end = Math.min(index, pointNums.length - 2);
		for (let i = 0; i < end; i += 2) {
			draw(pointNums[i], pointNums[i + 1], pointNums[i + 2], pointNums[i + 3], orange[400], orange[300]);
		}
	}

	export function setCenteredBounds(centered: boolean) {
		useCenteredBounds = centered;
	}

	async function preciseMessageDelay(iterations: number) {
		for (let i = 0; i < iterations; i++) {
			await new Promise((resolve) => {
				const mc = new MessageChannel();
				mc.port1.onmessage = resolve;
				mc.port2.postMessage(null);
			});
		}
	}

	export async function triggerPreview(delay = 0) {
		if (!ctx || pointNums.length < 4) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		preview = true;
		for (let i = 0; i < pointNums.length - 2; i += 2) {
			draw(pointNums[i], pointNums[i + 1], pointNums[i + 2], pointNums[i + 3]);
			if (delay > 0) await preciseMessageDelay(delay);
			if (!preview) {
				return;
			}
		}
		preview = false;
	}

	export function processLines(newLines: string[], skipAutoPreview = false) {
		lines = newLines;
		recalculate(skipAutoPreview);
	}

	export function recalculate(skipAutoPreview = false) {
		if (lines.length === 0) return;
		pointNums = parseGcode(lines);
		if (!skipAutoPreview) triggerPreview();
	}

	function draw(
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		stroke: string = orange[300],
		fill: string = orange[200],
		targetCtx: CanvasRenderingContext2D | null = ctx
	) {
		if (!targetCtx) return;
		const ctx = targetCtx;

		ctx.beginPath();
		ctx.moveTo(x1, y1);
		ctx.lineTo(x2, y2);
		ctx.strokeStyle = stroke;
		ctx.lineWidth = line;
		ctx.stroke();

		ctx.strokeStyle = fill;
		ctx.lineWidth = 0.8 * line;
		ctx.stroke();

		ctx.closePath();
	}

	function manualDraw(x: number, y: number) {
		if (!drawing) return;

		if (pointNums.length == 0) {
			draw(x, y, x, y);
		} else {
			draw(pointNums[pointNums.length - 2], pointNums[pointNums.length - 1], x, y);
		}
		pointNums.push(x, y);
		pointNums = pointNums; // trigger reactivity
	}

	function tokenizeGCodeLine(line: string): { [key: string]: string | number } {
		const tokens: { [key: string]: string | number } = {};
		const words = line.trim().split(/\s+/);
		for (const word of words) {
			const code = word.charAt(0);
			const value = word.slice(1).trim();
			const parsedValue = !isNaN(parseFloat(value)) ? parseFloat(value) : value;

			if (code) {
				tokens[code] = parsedValue;
			}
		}
		return tokens;
	}

	function scaleNums(nums: number[], centered: boolean) {
		if (nums.length < 2) return nums;

		let minX = nums[0];
		let maxX = nums[0];
		let minY = nums[1];
		let maxY = nums[1];

		for (let j, i = 0; i < nums.length; i += 2) {
			j = i + 1;
			minX = Math.min(minX, nums[i]);
			maxX = Math.max(maxX, nums[i]);
			minY = Math.min(minY, nums[j]);
			maxY = Math.max(maxY, nums[j]);
		}

		const fullWidth = maxX - minX;
		const fullHeight = maxY - minY;
		const safeWidth = fullWidth === 0 ? 1 : fullWidth;
		const safeHeight = fullHeight === 0 ? 1 : fullHeight;
		const scale = Math.min(1, maxWidth / safeWidth, maxHeight / safeHeight);
		const offsetX = centered ? line / 2 + (maxWidth - fullWidth * scale) / 2 : line / 2;
		const offsetY = centered ? line / 2 + (maxHeight - fullHeight * scale) / 2 : line / 2;

		for (let i = 0; i < nums.length; i += 2) {
			nums[i] = centered ? (nums[i] - minX) * scale + offsetX : nums[i] * scale + offsetX;
			nums[i + 1] = centered
				? (nums[i + 1] - minY) * scale + offsetY
				: nums[i + 1] * scale + offsetY;
		}

		return nums;
	}

	function parseGcode(lines: string[]) {
		let nums: number[] = [];
		let x: number = 0;
		let y: number = 0;
		for (const rawLine of lines) {
			const line = rawLine.split(';')[0].trim();
			if (line === '') continue;

			const tokens = tokenizeGCodeLine(line);
			if ('G' in tokens && (tokens['G'] == 0 || tokens['G'] == 1)) {
				if ('X' in tokens) x = parseFloat(tokens['X'].toString());
				if ('Y' in tokens) y = parseFloat(tokens['Y'].toString());
				nums.push(x, y);
			}
		}
		return scaleNums(nums, useCenteredBounds);
	}

	function getCanvasCoords(event: MouseEvent | TouchEvent): [number, number] {
		const rect = canvas.getBoundingClientRect();
		const scaleX = canvas.width / rect.width;
		const scaleY = canvas.height / rect.height;

		let clientX, clientY;

		if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) {
			clientX = event.touches[0].clientX;
			clientY = event.touches[0].clientY;
		} else {
			const mouseEvent = event as MouseEvent;
			clientX = mouseEvent.clientX;
			clientY = mouseEvent.clientY;
		}

		const x = (clientX - rect.left) * scaleX;
		const y = (clientY - rect.top) * scaleY;
		const invertedY = canvas.height - y;

		return [x, invertedY];
	}

	onMount(() => {
		ctx = canvas.getContext('2d');
		if (ctx) {
			ctx.lineJoin = 'round';
			ctx.lineCap = 'round';
			ctx.globalAlpha = 0.9;
			ctx.translate(0, canvas.height);
			ctx.scale(1, -1);
		}
		bgCtx = bgCanvas.getContext('2d');
		if (bgCtx) {
			bgCtx.lineJoin = 'round';
			bgCtx.lineCap = 'round';
			bgCtx.translate(0, bgCanvas.height);
			bgCtx.scale(1, -1);
		}
	});

	position.subscribe(($position) => {
		if (!ctx) return;
		if ($machineStats.homing || !$machineStats.executing) return;

		draw($prevPosition.x, $prevPosition.y, $position.x, $position.y, orange[400], orange[300]);

		ctx.beginPath();
		ctx.arc($position.x, $position.y, 4, 0, 2 * Math.PI, true);
		ctx.fillStyle = 'red';
		ctx.fill();
		ctx.closePath();
	});

	function startManualDraw() {
		if (preview) return;
		drawing = true;
	}

	function stopManualDraw() {
		drawing = false;
	}
</script>

<div class="flex flex-col items-center relative rounded-box overflow-hidden border border-base-300">
	<canvas
		bind:this={bgCanvas}
		{width}
		{height}
		class="touch-none bg-orange-100 max-w-[490px] w-full absolute inset-0"
	>
	</canvas>
	<canvas
		bind:this={canvas}
		onmousedown={startManualDraw}
		onmousemove={(e) => manualDraw(...getCanvasCoords(e))}
		onmouseup={stopManualDraw}
		ontouchstart={startManualDraw}
		ontouchmove={(e) => manualDraw(...getCanvasCoords(e))}
		ontouchend={stopManualDraw}
		{width}
		{height}
		class="touch-none max-w-[490px] w-full relative {preview ? 'pointer-events-none' : ''}"
	>
	</canvas>
</div>
