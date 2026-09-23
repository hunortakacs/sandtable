<script lang="ts">
	import { onMount } from 'svelte';
	import colors from 'tailwindcss/colors';
	import { espConnected, machineStats, patternIndex, position } from './stores';
	const { orange } = colors;

	export let width = 490;
	export let height = 490;
	export let line = 8;

	export let pointNums: number[] = [];

	let maxWidth = width - line;
	let maxHeight = height - line;
	$: maxWidth = width - line;
	$: maxHeight = height - line;

	// The two styles the preview is built out of: the part of the path the
	// machine has already drawn, and the part it hasn't.
	const TRAVERSED = { stroke: orange[400], fill: orange[300], scale: 1 };
	const FUTURE = { stroke: orange[300], fill: orange[200], scale: 0.8 };
	const DOT_RADIUS = 5;

	let useCenteredBounds = true;
	let lines: string[] = [];

	// Three stacked layers, because they change at wildly different rates and
	// mixing them was what broke the preview: the dot and the live segment have
	// to be erasable every single position update, while the path underneath
	// them must not be. Drawing all three onto one canvas meant every dot ever
	// reported stayed on screen as a red smear, and the only way to erase one
	// was to erase the path with it.
	//   bgCanvas    — the whole path, FUTURE style. Written once per pattern.
	//   canvas      — the traversed path, TRAVERSED style. Appended to as the
	//                 machine confirms coordinates. Also the editor's own
	//                 drawing surface (manual draw / preview animation).
	//   fgCanvas    — the live segment from the last confirmed coordinate to
	//                 the machine, plus the dot. Cleared and redrawn wholesale.
	let bgCanvas: HTMLCanvasElement;
	let canvas: HTMLCanvasElement;
	let fgCanvas: HTMLCanvasElement;
	let bgCtx: CanvasRenderingContext2D | null;
	let ctx: CanvasRenderingContext2D | null;
	let fgCtx: CanvasRenderingContext2D | null;

	let drawing = false;
	let preview = false;

	// True when pointNums is the pattern the machine is actually reading (as
	// opposed to something loaded into the editor), i.e. when the reported
	// coordinate index means anything.
	let livePath = false;
	// How far the traversed layer has actually been stroked, as a coordinate
	// index (pointNums[2i], pointNums[2i + 1]). -1 = nothing drawn yet.
	let trailIndex = -1;

	const coordinateCount = (nums: number[]) => Math.floor(nums.length / 2);

	export function clear() {
		preview = false;
		drawing = false;
		livePath = false;
		pointNums = [];
		lines = [];
		trailIndex = -1;
		ctx?.clearRect(0, 0, width, height);
		bgCtx?.clearRect(0, 0, width, height);
		renderLive();
	}

	// Adopts the pattern the ESP reports as currently playing, from its own
	// compiled coordinate bytes (decoded by the caller into raw x/y pairs) —
	// the only source of truth for what the machine is drawing, since an
	// uploaded/queued pattern has no corresponding static .gcode asset on the
	// frontend to re-parse. These numbers were already fit to canvas space by
	// scaleNums() once, at upload time (that's what got encoded into the .bin
	// the ESP reads from), so — unlike processLines()'s freshly-parsed-gcode
	// path — they must NOT be scaled again here.
	//
	// Progress is not a parameter: it comes from the patternIndex store, which
	// the firmware keeps up to date, so a pattern loaded halfway through (page
	// refresh, reconnect) paints its traversed portion immediately and then
	// just keeps following along.
	export function loadDeviceCoordinates(rawPointNums: number[]) {
		pointNums = rawPointNums;
		livePath = true;
		preview = false;
		trailIndex = -1;
		renderPath();
	}

	export function setCenteredBounds(centered: boolean) {
		useCenteredBounds = centered;
	}

	export function processLines(newLines: string[], skipAutoPreview = false) {
		lines = newLines;
		recalculate(skipAutoPreview);
	}

	export function recalculate(skipAutoPreview = false) {
		if (lines.length === 0) return;
		livePath = false;
		trailIndex = -1;
		pointNums = parseGcode(lines);
		renderPath();
		if (!skipAutoPreview) triggerPreview();
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

	// Editor-only animation: traces the loaded shape in the traversed style so
	// you can see the drawing order. Unrelated to what the machine is doing.
	export async function triggerPreview(delay = 0) {
		if (!ctx || pointNums.length < 4) return;
		livePath = false;
		trailIndex = -1;
		ctx.clearRect(0, 0, width, height);
		preview = true;
		for (let i = 0; i < coordinateCount(pointNums) - 1; i++) {
			drawSegment(ctx, i, TRAVERSED);
			if (delay > 0) await preciseMessageDelay(delay);
			if (!preview) return;
		}
		preview = false;
	}

	// ---------------------------------------------------------------------
	// Rendering
	// ---------------------------------------------------------------------

	function stroke(
		targetCtx: CanvasRenderingContext2D,
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		style: { stroke: string; fill: string; scale: number }
	) {
		targetCtx.beginPath();
		targetCtx.moveTo(x1, y1);
		targetCtx.lineTo(x2, y2);
		targetCtx.strokeStyle = style.stroke;
		targetCtx.lineWidth = line * style.scale;
		targetCtx.stroke();

		targetCtx.strokeStyle = style.fill;
		targetCtx.lineWidth = 0.8 * line * style.scale;
		targetCtx.stroke();

		targetCtx.closePath();
	}

	// Segment from coordinate `index` to coordinate `index + 1`.
	function drawSegment(
		targetCtx: CanvasRenderingContext2D,
		index: number,
		style: { stroke: string; fill: string; scale: number }
	) {
		const i = index * 2;
		stroke(targetCtx, pointNums[i], pointNums[i + 1], pointNums[i + 2], pointNums[i + 3], style);
	}

	// Repaints the two slow layers from scratch: the whole shape in FUTURE
	// style underneath, and the traversed prefix on top of it.
	function renderPath() {
		if (!ctx || !bgCtx) return;
		bgCtx.clearRect(0, 0, width, height);
		ctx.clearRect(0, 0, width, height);
		trailIndex = -1;

		for (let i = 0; i < coordinateCount(pointNums) - 1; i++) {
			drawSegment(bgCtx, i, FUTURE);
		}

		renderTrail();
		renderLive();
	}

	// Extends (or, if the machine went backwards, rebuilds) the traversed layer
	// so it ends exactly at the last coordinate the firmware has confirmed.
	function renderTrail() {
		if (!ctx || !livePath) return;

		const target = Math.min($patternIndex, coordinateCount(pointNums) - 1);
		if (target === trailIndex) return;

		if (target < trailIndex) {
			// Restarted, stepped back, or switched pattern: nothing of the old
			// trail can be trusted, so start over rather than leaving orphaned
			// strokes behind.
			ctx.clearRect(0, 0, width, height);
			trailIndex = -1;
		}
		if (target < 0) return;

		for (let i = Math.max(trailIndex, 0); i < target; i++) {
			drawSegment(ctx, i, TRAVERSED);
		}
		trailIndex = target;
	}

	// The only layer that is cleared on every update: the stretch the machine
	// is currently traversing (from the last confirmed coordinate to where it
	// actually is), and the dot itself — always last, so it sits above
	// everything else.
	function renderLive() {
		if (!fgCtx) return;
		fgCtx.clearRect(0, 0, width, height);

		if (livePath && trailIndex >= 0 && trailIndex < coordinateCount(pointNums)) {
			const i = trailIndex * 2;
			stroke(fgCtx, pointNums[i], pointNums[i + 1], $position.x, $position.y, TRAVERSED);
		}

		// The machine only knows where it is once homing has established an
		// origin, and we only know that while the ESP is actually reporting —
		// before either, any dot we drew would be a guess.
		if (!$machineStats.homed || !$espConnected) return;

		fgCtx.beginPath();
		fgCtx.arc($position.x, $position.y, DOT_RADIUS, 0, 2 * Math.PI);
		fgCtx.fillStyle = 'red';
		fgCtx.fill();
		fgCtx.closePath();
	}

	// Every live input funnels through here, so the trail, the live segment and
	// the dot are always painted from the same snapshot and can't disagree. The
	// arguments exist purely to declare what this depends on.
	function renderFrame(..._deps: unknown[]) {
		renderTrail();
		renderLive();
	}

	$: renderFrame(
		$position,
		$patternIndex,
		$machineStats.homed,
		$espConnected,
		pointNums,
		livePath,
		fgCtx
	);

	// ---------------------------------------------------------------------
	// Editor input / gcode parsing
	// ---------------------------------------------------------------------

	function manualDraw(x: number, y: number) {
		if (!drawing || !ctx) return;

		livePath = false;
		if (pointNums.length == 0) {
			stroke(ctx, x, y, x, y, TRAVERSED);
		} else {
			stroke(
				ctx,
				pointNums[pointNums.length - 2],
				pointNums[pointNums.length - 1],
				x,
				y,
				TRAVERSED
			);
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

	// The machine's origin is bottom-left; the canvas's is top-left. Flipping
	// the context once here means every coordinate — pattern points and live
	// position alike — is used verbatim, in machine millimetres, which is also
	// exactly the pixel space patterns were scaled into at upload time.
	function prepare(target: HTMLCanvasElement, alpha = 1): CanvasRenderingContext2D | null {
		const context = target.getContext('2d');
		if (!context) return null;
		context.lineJoin = 'round';
		context.lineCap = 'round';
		context.globalAlpha = alpha;
		context.translate(0, target.height);
		context.scale(1, -1);
		return context;
	}

	onMount(() => {
		bgCtx = prepare(bgCanvas);
		ctx = prepare(canvas, 0.9);
		fgCtx = prepare(fgCanvas);
		renderPath();
	});

	function startManualDraw() {
		if (preview || livePath) return;
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
		class="touch-none max-w-[490px] w-full relative {preview || livePath
			? 'pointer-events-none'
			: ''}"
	>
	</canvas>
	<canvas
		bind:this={fgCanvas}
		{width}
		{height}
		class="touch-none max-w-[490px] w-full absolute inset-0 pointer-events-none"
	>
	</canvas>
</div>
