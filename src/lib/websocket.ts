import { get } from 'svelte/store';
import {
	espConnected,
	machinePatterns,
	machineStats,
	socketState,
	sendingPattern,
	uploadError,
	currentFile,
	patternIndex,
	position,
	feedrate,
	led,
	fan,
	lastRelayMessage,
	sentPacketCount,
	totalPacketCount,
	playbackMode,
	queueIndex,
	queue,
	autoclean,
	logEnabled
} from './stores';

enum BoolMask {
	BUSY = 0x80,
	EXECUTING = 0x40,
	HOMING = 0x20,
	YHOMED = 0x10,
	HOMED = 0x08,
	SAFEMODE = 0x04,
	LOG_ENABLED = 0x02
}

export enum WSCmdType_t {
	WSCmdType_ACK = 0x00,
	WSCmdType_HOME = 0x01,
	WSCmdType_MOVE = 0x02,
	WSCmdType_STOP = 0x03,
	WSCmdType_PAUSE = 0x04,
	WSCmdType_RESUME = 0x05,
	WSCmdType_LED = 0x06,
	WSCmdType_FEEDRATE = 0x07,
	WSCmdType_PATTERN_START = 0x08,
	WSCmdType_PATTERN = 0x09,
	WSCmdType_PATTERN_FIN = 0x0a,
	WSCmdType_FAN = 0x0b,
	WSCmdType_STAT = 0x0c,
	WSCmdType_START = 0x0d,
	WSCmdType_ESP_STATE = 0x0f,
	WSCmdType_SAFEMODE = 0x10,
	WSCmdType_DELETE_FILE = 0x11,
	WSCmdType_LOG_LEVEL = 0x12,
	WSCmdType_POSITION = 0x13,
	WSCmdType_CURRENT_FILE = 0x14,
	WSCmdType_QUEUE_INSERT = 0x15,
	WSCmdType_QUEUE_REMOVE = 0x16,
	WSCmdType_QUEUE_MOVE = 0x17,
	WSCmdType_QUEUE_CLEAR = 0x18,
	WSCmdType_QUEUE_STATE = 0x19,
	WSCmdType_PLAY_QUEUE = 0x1a,
	WSCmdType_PLAY_SHUFFLE = 0x1b,
	WSCmdType_AUTOCLEAN = 0x1c,
	WSCmdType_FILE_META = 0x1d,
	WSCmdType_CANCEL_UPLOAD = 0x1e,
	WSCmdType_SKIP = 0x1f,
	WSCmdType_PREVIOUS = 0x20,
	WSCmdType_PATTERN_DATA = 0x21
}

export let ws: WebSocket;

export function isSocketOpen() {
	return !!ws && ws.readyState === WebSocket.OPEN;
}

// Commands are fire-and-forget, and the socket can be down at any moment (that
// is the normal state of this system between reconnects). Dropping a command
// with a warning keeps a button press from throwing out of its click handler
// and leaving the UI in a half-updated state.
function send(payload: ArrayBufferLike | ArrayBufferView) {
	if (!isSocketOpen()) {
		console.warn('Not connected — dropping command');
		return false;
	}
	ws.send(payload as ArrayBuffer);
	return true;
}

let ackResolve: ((ok: boolean) => void) | null = null;

// Only the most recently requested pattern's data is ever wanted — e.g.
// currentFile can change again (skip, autoclean transition) before a
// previous, possibly multi-second, download finishes. A single slot here
// (rather than one per request) meant a newer request silently clobbered an
// older one's resolver: when the ESP's response for the OLD request
// eventually arrived, it resolved the NEW promise with the wrong bytes, and
// the old promise was left to time out uselessly 20s later — the exact
// "Pattern data request timed out" / "have to refresh" symptom. Now a newer
// request immediately (and cleanly) rejects whatever was still pending, and
// the response is matched by filename so a stale reply can't be misapplied.
let currentPatternDataRequest: {
	resolve: (bytes: Uint8Array) => void;
	reject: (err: Error) => void;
	filename: string;
} | null = null;

// Requests the exact compiled coordinate bytes the ESP has stored for
// `filename` (whatever it's currently reading, or any other pattern it
// knows about) — this is the actual source of truth for what the machine is
// drawing, unlike the static bundled /patterns/*.gcode assets, which only
// cover the built-in demo library and never exist for anything uploaded or
// queued by the user.
export async function requestPatternData(filename: string, timeoutMs = 20000): Promise<Uint8Array> {
	if (currentPatternDataRequest) {
		currentPatternDataRequest.reject(new Error('Superseded by a newer pattern data request'));
		currentPatternDataRequest = null;
	}

	return new Promise<Uint8Array>((resolve, reject) => {
		const timer = setTimeout(() => {
			if (currentPatternDataRequest?.resolve !== resolve) return;
			currentPatternDataRequest = null;
			reject(new Error('Pattern data request timed out'));
		}, timeoutMs);

		currentPatternDataRequest = {
			resolve: (bytes: Uint8Array) => {
				clearTimeout(timer);
				resolve(bytes);
			},
			reject: (err: Error) => {
				clearTimeout(timer);
				reject(err);
			},
			filename
		};

		const charArray = new TextEncoder().encode(filename);
		if (!send(new Uint8Array([WSCmdType_t.WSCmdType_PATTERN_DATA, ...charArray, 0x00]))) {
			// Fail now rather than sitting on a promise nobody can ever resolve.
			currentPatternDataRequest?.reject(new Error('Not connected'));
			currentPatternDataRequest = null;
		}
	});
}

// Resolves with false when the ESP's ack payload carries an explicit failure
// byte (currently only PATTERN_FIN does, on a checksum mismatch) — every
// other ack is a bare success.
export async function waitForAck(timeoutMs = 10000): Promise<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		let isDone = false;
		const timer = setTimeout(() => {
			if (isDone) return;
			isDone = true;
			ackResolve = null;
			reject(new Error('ACK Timeout - ESP32 stopped responding'));
		}, timeoutMs);

		ackResolve = (ok: boolean) => {
			if (isDone) return;
			isDone = true;
			clearTimeout(timer);
			resolve(ok);
		};
	});
}

function handleBinaryMessage(data: any) {
	const dataView = new DataView(data);
	if (dataView.byteLength == 0) return;

	const cmdByte = dataView.getUint8(0);

	let decoder: TextDecoder;
	let charArray: Uint8Array;
	switch (cmdByte as WSCmdType_t) {
		case WSCmdType_t.WSCmdType_ACK: {
			const ok = dataView.byteLength < 2 || dataView.getUint8(1) !== 0;
			if (ackResolve) ackResolve(ok);
			ackResolve = null;
			break;
		}
		case WSCmdType_t.WSCmdType_POSITION:
			// [cmd][x u16][y u16][last reached coordinate index i32]. Position
			// and index travel together so the canvas can never draw a trail
			// that disagrees with where it puts the dot.
			position.set({
				x: dataView.getUint16(1) / 100.0,
				y: dataView.getUint16(3) / 100.0
			});
			if (dataView.byteLength >= 9) patternIndex.set(dataView.getInt32(5));
			break;
		case WSCmdType_t.WSCmdType_STAT:
			console.log('Stats received');
			const statusBools = dataView.getUint8(1);
			const configBools = dataView.getUint8(2);

			// bit layout matches firmware's websocket_handler.cpp sendStats: playbackMode
			// needs 2 bits (IDLE=0, QUEUE=1, SHUFFLE=2), so autoclean/logEnabled moved up
			// to bits 3/2 to make room.
			autoclean.set(Boolean(configBools & 0x08));
			logEnabled.set(Boolean(configBools & 0x04));
			playbackMode.set(configBools & 0x03);

			position.set({
				x: dataView.getUint16(3) / 100.0,
				y: dataView.getUint16(5) / 100.0
			});
			feedrate.set(dataView.getUint16(7));
			led.set(dataView.getUint8(9));
			fan.set(dataView.getUint8(10));

			machineStats.set({
				busy: Boolean(statusBools & BoolMask.BUSY),
				executing: Boolean(statusBools & BoolMask.EXECUTING),
				homing: Boolean(statusBools & BoolMask.HOMING),
				yHomed: Boolean(statusBools & BoolMask.YHOMED),
				homed: Boolean(statusBools & BoolMask.HOMED),
				safemode: Boolean(statusBools & BoolMask.SAFEMODE)
			});
			break;
		case WSCmdType_t.WSCmdType_FILE_META:
			console.log('File metadata received');
			const numFiles = dataView.getUint8(1);
			charArray = new Uint8Array(dataView.buffer);
			decoder = new TextDecoder('utf-8');
			let offset = 2;
			let parsedFiles: { filename: string; type: number }[] = [];
			for (let i = 0; i < numFiles; i++) {
				let type = charArray[offset++];
				let start = offset;
				while (offset < charArray.length && charArray[offset] !== 0) offset++;
				let name = decoder.decode(charArray.slice(start, offset));
				offset++; // skip null byte
				parsedFiles.push({ filename: name, type });
			}
			machinePatterns.set(parsedFiles);
			break;
		case WSCmdType_t.WSCmdType_QUEUE_STATE:
			console.log('Queue state received');
			playbackMode.set(dataView.getUint8(1));
			queueIndex.set(dataView.getInt16(2));
			let numQueue = dataView.getUint16(4);
			charArray = new Uint8Array(dataView.buffer);
			decoder = new TextDecoder('utf-8');
			let qOffset = 6;
			let qFiles: string[] = [];
			for (let i = 0; i < numQueue; i++) {
				let start = qOffset;
				while (qOffset < charArray.length && charArray[qOffset] !== 0) qOffset++;
				let name = decoder.decode(charArray.slice(start, qOffset));
				qOffset++; // skip null byte
				qFiles.push(name);
			}
			queue.set(qFiles);
			break;
		case WSCmdType_t.WSCmdType_CURRENT_FILE: {
			console.log('Current file received');
			// [cmd][last reached coordinate index i32][filename\0]. The index is
			// set before the filename so anything reacting to a new file already
			// sees the progress that belongs to it — this is what lets a page
			// that loads mid-pattern redraw the traversed part straight away.
			patternIndex.set(dataView.getInt32(1));
			charArray = new Uint8Array(dataView.buffer);
			decoder = new TextDecoder('utf-8');
			currentFile.set(decoder.decode(charArray.slice(5, charArray.length - 1)));
			break;
		}
		case WSCmdType_t.WSCmdType_PATTERN_DATA: {
			// Payload: [cmd(1)] [filename...\0] [coordinate bytes...]
			charArray = new Uint8Array(dataView.buffer);
			let nameEnd = 1;
			while (nameEnd < charArray.length && charArray[nameEnd] !== 0) nameEnd++;
			const filename = new TextDecoder('utf-8').decode(charArray.slice(1, nameEnd));
			const bytes = charArray.slice(nameEnd + 1);
			if (currentPatternDataRequest && currentPatternDataRequest.filename === filename) {
				currentPatternDataRequest.resolve(bytes);
				currentPatternDataRequest = null;
			}
			break;
		}
		case WSCmdType_t.WSCmdType_ESP_STATE: {
			// The relay restates this every few seconds, so it is both an edge
			// ("the ESP just appeared/vanished") and a liveness beat. Only the
			// rising edge triggers a refetch — re-requesting the file index and
			// queue on every beat would have the ESP hitting flash every 5s.
			const connected = dataView.getUint8(1) > 0;
			const wasConnected = get(espConnected);
			espConnected.set(connected);
			if (connected && !wasConnected) {
				console.log('ESP connected');
				requestFullState();
			} else if (!connected && wasConnected) {
				console.warn('ESP disconnected');
			}
			break;
		}
	}
}

// The relay states the ESP's status unprompted every 5s. Going this long
// without hearing anything at all therefore means this connection is dead,
// whatever readyState claims — a socket whose underlying TCP connection has
// been silently dropped (sleeping laptop, NAT timeout, relay redeployed) can
// sit in OPEN for minutes before the browser admits it. That window was the
// reason the ESP's status could only be trusted right after a page reload.
const RELAY_SILENCE_TIMEOUT_MS = 15000;
const LIVENESS_CHECK_INTERVAL_MS = 1000;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 10000;

let relayUrl = '';
let relayPassword = '';
let closedByUs = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let livenessTimer: ReturnType<typeof setInterval> | null = null;

// Everything a freshly (re)connected client needs to render a correct view
// without a page reload: machine state, what's playing and how far in, the
// pattern index, and the queue.
function requestFullState() {
	sendStatRequest();
	sendCurrentFileRequest();
	send(new Uint8Array([WSCmdType_t.WSCmdType_FILE_META]));
	send(new Uint8Array([WSCmdType_t.WSCmdType_QUEUE_STATE]));
}

function noteRelayActivity() {
	lastRelayMessage.set(Date.now());
}

// Losing the relay means everything we believe about the ESP is now hearsay.
function markDisconnected() {
	espConnected.set(false);
}

function scheduleReconnect() {
	if (closedByUs || reconnectTimer) return;

	const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts, RECONNECT_MAX_DELAY_MS);
	reconnectAttempts++;
	console.log(`Reconnecting in ${delay}ms`);
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		connect();
	}, delay);
}

function startLivenessWatchdog() {
	if (livenessTimer) return;
	livenessTimer = setInterval(() => {
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		if (Date.now() - get(lastRelayMessage) < RELAY_SILENCE_TIMEOUT_MS) return;

		console.warn('No traffic from the relay — treating this connection as dead');
		markDisconnected();
		// close() runs onclose, which is what actually schedules the reconnect.
		ws.close();
	}, LIVENESS_CHECK_INTERVAL_MS);
}

function connect() {
	// Never stack sockets: a stale one still holds handlers that would keep
	// writing to the same stores as the live one.
	if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

	const socket = new WebSocket(relayUrl, ['webapp', relayPassword]);
	ws = socket;
	socket.binaryType = 'arraybuffer';
	socketState.set(socket.readyState);
	noteRelayActivity();

	// Every handler is scoped to the socket that installed it, so one being
	// reaped late can't overwrite the state of its replacement.
	const isCurrent = () => ws === socket;

	socket.onopen = () => {
		if (!isCurrent()) return;
		console.log('WebSocket connected');
		reconnectAttempts = 0;
		socketState.set(socket.readyState);
		noteRelayActivity();
	};

	socket.onmessage = (message) => {
		if (!isCurrent()) return;
		noteRelayActivity();
		handleBinaryMessage(message.data);
	};

	socket.onerror = (error) => {
		if (!isCurrent()) return;
		console.error('WebSocket Error:', error);
		socketState.set(socket.readyState);
	};

	socket.onclose = ({ code, reason }) => {
		if (!isCurrent()) return;
		console.warn(`WebSocket closed (Code: ${code}, Reason: ${reason})`);
		socketState.set(WebSocket.CLOSED);
		markDisconnected();
		scheduleReconnect();
	};
}

export function openSocket(websocket_password: string, relay_url: string) {
	relayUrl = relay_url;
	relayPassword = websocket_password;
	closedByUs = false;
	reconnectAttempts = 0;
	startLivenessWatchdog();
	connect();
}

export function closeSocket() {
	closedByUs = true;
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	if (livenessTimer) {
		clearInterval(livenessTimer);
		livenessTimer = null;
	}
	markDisconnected();
	if (ws) {
		ws.close();
		socketState.set(ws.readyState);
	}
}

export function sendFanValue(value: number) {
	send(new Uint8Array([WSCmdType_t.WSCmdType_FAN, value]));
}

export function sendLedValue(value: number) {
	send(new Uint8Array([WSCmdType_t.WSCmdType_LED, value]));
}

export function sendStart(pattern: string) {
	const charArray = new TextEncoder().encode(pattern);
	send(new Uint8Array([WSCmdType_t.WSCmdType_START, ...charArray, 0x00]));
}

export function sendPause() {
	send(new Uint8Array([WSCmdType_t.WSCmdType_PAUSE]));
}

export function sendResume() {
	send(new Uint8Array([WSCmdType_t.WSCmdType_RESUME]));
}

export function sendStop() {
	send(new Uint8Array([WSCmdType_t.WSCmdType_STOP]));
}

export function sendSkip() {
	send(new Uint8Array([WSCmdType_t.WSCmdType_SKIP]));
}

export function sendPrevious() {
	send(new Uint8Array([WSCmdType_t.WSCmdType_PREVIOUS]));
}

export function sendHome() {
	send(new Uint8Array([WSCmdType_t.WSCmdType_HOME]));
}

export function sendMove(dx: number, dy: number) {
	let view = new DataView(new ArrayBuffer(3));
	view.setUint8(0, WSCmdType_t.WSCmdType_MOVE);
	view.setInt8(1, dx);
	view.setInt8(2, dy);
	send(new Uint8Array(view.buffer));
}

export function sendSafemode(safemode: boolean) {
	send(new Uint8Array([WSCmdType_t.WSCmdType_SAFEMODE, safemode ? 1 : 0]));
}

export function sendStatRequest() {
	send(new Uint8Array([WSCmdType_t.WSCmdType_STAT]));
}

export function sendCurrentFileRequest() {
	send(new Uint8Array([WSCmdType_t.WSCmdType_CURRENT_FILE]));
}

export function sendDeletePattern(pattern: string) {
	const charArray = new TextEncoder().encode(pattern);
	send(new Uint8Array([WSCmdType_t.WSCmdType_DELETE_FILE, ...charArray, 0x00]));
}

export function sendFeedrateValue(value: number) {
	let view = new DataView(new ArrayBuffer(3));
	view.setUint8(0, WSCmdType_t.WSCmdType_FEEDRATE);
	view.setUint16(1, value);
	send(new Uint8Array(view.buffer));
}

export function sendLogLevel(level: boolean) {
	send(new Uint8Array([WSCmdType_t.WSCmdType_LOG_LEVEL, level ? 1 : 0]));
}

export function sendQueueInsert(pattern: string, position: number = 0xffff) {
	const charArray = new TextEncoder().encode(pattern);
	let view = new DataView(new ArrayBuffer(3 + charArray.length + 1));
	view.setUint8(0, WSCmdType_t.WSCmdType_QUEUE_INSERT);
	view.setUint16(1, position);
	new Uint8Array(view.buffer).set(charArray, 3);
	new Uint8Array(view.buffer)[3 + charArray.length] = 0;
	send(view.buffer);
}

export function sendQueueRemove(position: number) {
	let view = new DataView(new ArrayBuffer(3));
	view.setUint8(0, WSCmdType_t.WSCmdType_QUEUE_REMOVE);
	view.setUint16(1, position);
	send(view.buffer);
}

export function sendQueueMove(from: number, to: number) {
	let view = new DataView(new ArrayBuffer(5));
	view.setUint8(0, WSCmdType_t.WSCmdType_QUEUE_MOVE);
	view.setUint16(1, from);
	view.setUint16(3, to);
	send(view.buffer);
}

export function sendQueueClear() {
	send(new Uint8Array([WSCmdType_t.WSCmdType_QUEUE_CLEAR]));
}

export function sendPlayQueue() {
	send(new Uint8Array([WSCmdType_t.WSCmdType_PLAY_QUEUE]));
}

export function sendPlayShuffle() {
	send(new Uint8Array([WSCmdType_t.WSCmdType_PLAY_SHUFFLE]));
}

export function sendAutoclean(enabled: boolean) {
	send(new Uint8Array([WSCmdType_t.WSCmdType_AUTOCLEAN, enabled ? 1 : 0]));
}

function scaleNum(num: number) {
	return Math.round(num * 100) & 0xffff;
}

// Standard CRC32 (IEEE 802.3 / zlib variant), mirrored byte-for-byte by the
// firmware's own crc32Update/computeFileCrc32 in file_handler.cpp. Takes/
// returns the raw (not yet finalized — caller XORs with 0xffffffff at the
// end) running state so callers can fold in bytes incrementally across
// multiple calls — see sendPatternFragments, which accumulates the checksum
// from the exact same chunk buffers it sends, so there's no way for what's
// checksummed to diverge from what's actually transmitted.
function crc32Update(crc: number, bytes: Uint8Array): number {
	for (let i = 0; i < bytes.length; i++) {
		crc ^= bytes[i];
		for (let j = 0; j < 8; j++) {
			crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
		}
	}
	return crc;
}

async function sendPacket(pointOffset: number, dataBytes: Uint8Array) {
	const byteOffset = pointOffset * 2;

	// Per-chunk CRC32 so the ESP can catch a corrupted/torn/misordered chunk
	// immediately and NACK it for a retry, instead of only finding out after
	// the whole (possibly very long) upload via the final whole-file checksum.
	const chunkCrc = (crc32Update(0xffffffff, dataBytes) ^ 0xffffffff) >>> 0;

	const message = new Uint8Array(5 + dataBytes.length + 4);
	const header = new DataView(message.buffer);
	header.setUint8(0, WSCmdType_t.WSCmdType_PATTERN);
	header.setUint32(1, byteOffset);
	message.set(dataBytes, 5);
	header.setUint32(5 + dataBytes.length, chunkCrc);

	if (!send(message.buffer)) throw new Error('Not connected');
	const ok = await waitForAck();
	if (!ok) throw new Error(`ESP failed to write chunk at byte offset ${byteOffset}`);
}

export async function sendPatternFragments(
	pointNums: number[],
	name = 'pattern',
	isCleaner = false,
	coordinatePairs: number = 1024
) {
	sendingPattern.set(true);
	uploadError.set('');
	sentPacketCount.set(0);
	const total = Math.ceil(pointNums.length / (coordinatePairs * 2));
	totalPacketCount.set(total);

	const filePath = name.replace('.gcode', '') + '.bin';
	const charArray = new TextEncoder().encode(filePath);

	// Checksum accumulated incrementally from the exact same per-chunk byte
	// buffers handed to sendPacket below (see crc32Update) — built once and
	// folded in only after the ESP confirms that specific chunk, rather than
	// computed separately up front, so there's no way for "what's checksummed"
	// to diverge from "what's actually sent" (and retries can't double-count).
	let crc = 0xffffffff;

	let isResuming = false;
	let pointOffset = 0;
	let nums = coordinatePairs * 2;

	// A network blip (or the ESP rejecting a resume it can't honor, e.g.
	// after its own reboot) must not leave this loop retrying forever while
	// the UI keeps showing a normal-looking progress bar — bound the retries
	// and surface a real failure so the user knows to try again.
	const MAX_CONSECUTIVE_FAILURES = 8;
	let consecutiveFailures = 0;

	function giveUp(message: string) {
		console.error(message);
		sendingPattern.set(false);
		uploadError.set(message);
	}

	while (pointOffset < pointNums.length) {
		if (!get(sendingPattern)) return;

		let socketWaited = false;
		while (get(socketState) !== WebSocket.OPEN) {
			socketWaited = true;
			await new Promise((r) => setTimeout(r, 1000));
			consecutiveFailures++;
			if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
				giveUp('Upload failed: lost connection to the ESP and could not reconnect.');
				return;
			}
		}
		if (socketWaited) consecutiveFailures = 0;

		let needsFullRestart = false;
		try {
			if (pointOffset === 0 || isResuming) {
				let dataView = new DataView(new ArrayBuffer(6));
				dataView.setUint8(0, WSCmdType_t.WSCmdType_PATTERN_START);
				dataView.setUint8(1, isResuming ? 1 : 0);
				dataView.setUint32(2, pointNums.length * 2);
				if (!send(new Uint8Array([...new Uint8Array(dataView.buffer), ...charArray, 0x00])))
					throw new Error('Not connected');

				const startOk = await waitForAck();
				if (!startOk) {
					// The ESP couldn't honor the resume (e.g. it rebooted and lost
					// the in-progress .tmp) — resuming from a non-zero offset into
					// whatever it has now would corrupt the file, so start over
					// completely instead of retrying the same resume forever.
					if (isResuming) needsFullRestart = true;
					throw new Error('ESP rejected pattern transfer start');
				}
				isResuming = false;
			}

			const currentChunkSize = Math.min(nums, pointNums.length - pointOffset);
			const chunkBytes = new Uint8Array(currentChunkSize * 2);
			const chunkView = new DataView(chunkBytes.buffer);
			for (let i = 0; i < currentChunkSize; i++) {
				chunkView.setUint16(i * 2, scaleNum(pointNums[pointOffset + i]));
			}

			await sendPacket(pointOffset, chunkBytes);
			crc = crc32Update(crc, chunkBytes);

			pointOffset += currentChunkSize;
			sentPacketCount.update((n) => n + 1);
			consecutiveFailures = 0;
		} catch (error) {
			consecutiveFailures++;
			if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
				giveUp(`Upload failed after repeated errors: ${error}`);
				return;
			}
			if (needsFullRestart) {
				console.warn('Resume rejected, restarting upload from scratch...', error);
				pointOffset = 0;
				crc = 0xffffffff;
				sentPacketCount.set(0);
				isResuming = false;
			} else {
				console.warn('Fragment failed, holding state to resume...', error);
				isResuming = true;
			}
			await new Promise((r) => setTimeout(r, 2000));
		}
	}

	const checksum = (crc ^ 0xffffffff) >>> 0;

	let finSent = false;
	let finFailures = 0;
	while (!finSent) {
		try {
			const sent = send(
				new Uint8Array([
					WSCmdType_t.WSCmdType_PATTERN_FIN,
					isCleaner ? 1 : 0,
					(checksum >>> 24) & 0xff,
					(checksum >>> 16) & 0xff,
					(checksum >>> 8) & 0xff,
					checksum & 0xff
				])
			);
			if (!sent) throw new Error('Not connected');
			const ok = await waitForAck();
			if (!ok) {
				// Deterministic mismatch on the same data — retrying this same FIN
				// won't help (the ESP already discarded the corrupted upload), so
				// stop instead of retrying forever; the user can just hit Send again.
				giveUp('Pattern upload failed checksum verification on the ESP — discarded. Please retry.');
				return;
			}
			finSent = true;
		} catch (error) {
			finFailures++;
			if (finFailures > MAX_CONSECUTIVE_FAILURES) {
				giveUp(`Upload finish failed after repeated errors: ${error}`);
				return;
			}
			console.warn('Finish command failed, retrying...', error);
			await new Promise((r) => setTimeout(r, 2000));
		}
	}

	sendingPattern.set(false);
}

export function sendCancelUpload() {
	send(new Uint8Array([WSCmdType_t.WSCmdType_CANCEL_UPLOAD]));
	sendingPattern.set(false);
}
