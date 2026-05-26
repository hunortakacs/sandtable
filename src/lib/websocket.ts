import { get } from 'svelte/store';
import {
	espConnected,
	machinePatterns,
	machineStats,
	socketState,
	sendingPattern,
	currentFile,
	position,
	feedrate,
	led,
	fan,
	prevPosition,
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
	WSCmdType_CANCEL_UPLOAD = 0x1e
}

export let ws: WebSocket;

let ackResolve: (() => void) | null = null;

export async function waitForAck(timeoutMs = 10000) {
	return new Promise<void>((resolve, reject) => {
		let isDone = false;
		const timer = setTimeout(() => {
			if (isDone) return;
			isDone = true;
			ackResolve = null;
			reject(new Error('ACK Timeout - ESP32 stopped responding'));
		}, timeoutMs);

		ackResolve = () => {
			if (isDone) return;
			isDone = true;
			clearTimeout(timer);
			resolve();
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
		case WSCmdType_t.WSCmdType_ACK:
			if (ackResolve) ackResolve();
			ackResolve = null;
			break;
		case WSCmdType_t.WSCmdType_POSITION:
			prevPosition.set(get(position));
			position.set({
				x: dataView.getUint16(1) / 100.0,
				y: dataView.getUint16(3) / 100.0
			});
			break;
		case WSCmdType_t.WSCmdType_STAT:
			console.log('Stats received');
			const statusBools = dataView.getUint8(1);
			const configBools = dataView.getUint8(2);

			autoclean.set(Boolean(configBools & 0x04));
			logEnabled.set(Boolean(configBools & 0x02));
			playbackMode.set(configBools & 0x01);

			prevPosition.set(get(position));
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
		case WSCmdType_t.WSCmdType_CURRENT_FILE:
			console.log('Current file received');
			charArray = new Uint8Array(dataView.buffer);
			decoder = new TextDecoder('utf-8');
			currentFile.set(decoder.decode(charArray.slice(1, charArray.length - 1)));
			break;
		case WSCmdType_t.WSCmdType_ESP_STATE:
			espConnected.set(dataView.getUint8(1) > 0);
			if (get(espConnected) == true) {
				console.log('ESP connected');
				sendStatRequest();
				sendCurrentFileRequest();
				ws.send(new Uint8Array([WSCmdType_t.WSCmdType_FILE_META]));
				ws.send(new Uint8Array([WSCmdType_t.WSCmdType_QUEUE_STATE]));
			}
			break;
	}
}

export function openSocket(websocket_password: string) {
	ws = new WebSocket('wss://sandtable-websocket.onrender.com', ['webapp', websocket_password]);
	ws.binaryType = 'arraybuffer';
	socketState.set(ws.readyState);

	ws.onopen = () => {
		console.log('WebSocket connected');
		socketState.set(ws.readyState);
	};

	ws.onmessage = (message) => {
		handleBinaryMessage(message.data);
	};

	ws.onerror = (error) => {
		console.error('WebSocket Error:', error);
		socketState.set(ws.readyState);
	};

	ws.onclose = ({ code, reason }) => {
		console.warn(`WebSocket closed (Code: ${code}, Reason: ${reason})`);
		socketState.set(ws.readyState);

		setTimeout(() => openSocket(websocket_password), 5000);
	};
}

export function closeSocket() {
	if (ws) {
		ws.close();
		socketState.set(ws.readyState);
	}
}

export function sendFanValue(value: number) {
	ws.send(new Uint8Array([WSCmdType_t.WSCmdType_FAN, value]));
}

export function sendLedValue(value: number) {
	ws.send(new Uint8Array([WSCmdType_t.WSCmdType_LED, value]));
}

export function sendStart(pattern: string) {
	const charArray = new TextEncoder().encode(pattern);
	ws.send(new Uint8Array([WSCmdType_t.WSCmdType_START, ...charArray, 0x00]));
}

export function sendPause() {
	ws.send(new Uint8Array([WSCmdType_t.WSCmdType_PAUSE]));
}

export function sendResume() {
	ws.send(new Uint8Array([WSCmdType_t.WSCmdType_RESUME]));
}

export function sendStop() {
	ws.send(new Uint8Array([WSCmdType_t.WSCmdType_STOP]));
}

export function sendHome() {
	ws.send(new Uint8Array([WSCmdType_t.WSCmdType_HOME]));
}

export function sendMove(dx: number, dy: number) {
	let view = new DataView(new ArrayBuffer(3));
	view.setUint8(0, WSCmdType_t.WSCmdType_MOVE);
	view.setInt8(1, dx);
	view.setInt8(2, dy);
	ws.send(new Uint8Array(view.buffer));
}

export function sendSafemode(safemode: boolean) {
	ws.send(new Uint8Array([WSCmdType_t.WSCmdType_SAFEMODE, safemode ? 1 : 0]));
}

export function sendStatRequest() {
	ws.send(new Uint8Array([WSCmdType_t.WSCmdType_STAT]));
}

export function sendCurrentFileRequest() {
	ws.send(new Uint8Array([WSCmdType_t.WSCmdType_CURRENT_FILE]));
}

export function sendDeletePattern(pattern: string) {
	const charArray = new TextEncoder().encode(pattern);
	ws.send(new Uint8Array([WSCmdType_t.WSCmdType_DELETE_FILE, ...charArray, 0x00]));
}

export function sendFeedrateValue(value: number) {
	let view = new DataView(new ArrayBuffer(3));
	view.setUint8(0, WSCmdType_t.WSCmdType_FEEDRATE);
	view.setUint16(1, value);
	ws.send(new Uint8Array(view.buffer));
}

export function sendLogLevel(level: boolean) {
	ws.send(new Uint8Array([WSCmdType_t.WSCmdType_LOG_LEVEL, level ? 1 : 0]));
}

export function sendQueueInsert(pattern: string, position: number = 0xffff) {
	const charArray = new TextEncoder().encode(pattern);
	let view = new DataView(new ArrayBuffer(3 + charArray.length + 1));
	view.setUint8(0, WSCmdType_t.WSCmdType_QUEUE_INSERT);
	view.setUint16(1, position);
	new Uint8Array(view.buffer).set(charArray, 3);
	new Uint8Array(view.buffer)[3 + charArray.length] = 0;
	ws.send(view.buffer);
}

export function sendQueueRemove(position: number) {
	let view = new DataView(new ArrayBuffer(3));
	view.setUint8(0, WSCmdType_t.WSCmdType_QUEUE_REMOVE);
	view.setUint16(1, position);
	ws.send(view.buffer);
}

export function sendQueueMove(from: number, to: number) {
	let view = new DataView(new ArrayBuffer(5));
	view.setUint8(0, WSCmdType_t.WSCmdType_QUEUE_MOVE);
	view.setUint16(1, from);
	view.setUint16(3, to);
	ws.send(view.buffer);
}

export function sendQueueClear() {
	ws.send(new Uint8Array([WSCmdType_t.WSCmdType_QUEUE_CLEAR]));
}

export function sendPlayQueue() {
	ws.send(new Uint8Array([WSCmdType_t.WSCmdType_PLAY_QUEUE]));
}

export function sendPlayShuffle() {
	ws.send(new Uint8Array([WSCmdType_t.WSCmdType_PLAY_SHUFFLE]));
}

export function sendAutoclean(enabled: boolean) {
	ws.send(new Uint8Array([WSCmdType_t.WSCmdType_AUTOCLEAN, enabled ? 1 : 0]));
}

function scaleNum(num: number) {
	return Math.round(num * 100) & 0xffff;
}

async function sendPacket(pointOffset: number, nums: number, pointNums: number[]) {
	const byteOffset = pointOffset * 2;

	let dataView = new DataView(new ArrayBuffer(1 + 4 + 2 * nums));
	dataView.setUint8(0, WSCmdType_t.WSCmdType_PATTERN);
	dataView.setUint32(1, byteOffset);

	for (let i = 0; i < nums; i++) {
		dataView.setUint16(5 + i * 2, scaleNum(pointNums[pointOffset + i]));
	}

	ws.send(dataView.buffer);
	await waitForAck();
}

export async function sendPatternFragments(
	pointNums: number[],
	name = 'pattern',
	isCleaner = false,
	coordinatePairs: number = 1024
) {
	sendingPattern.set(true);
	sentPacketCount.set(0);
	const total = Math.ceil(pointNums.length / (coordinatePairs * 2));
	totalPacketCount.set(total);

	const filePath = name.replace('.gcode', '') + '.bin';
	const charArray = new TextEncoder().encode(filePath);

	let isResuming = false;
	let pointOffset = 0;
	let nums = coordinatePairs * 2;

	while (pointOffset < pointNums.length) {
		if (!get(sendingPattern)) return;
		while (get(socketState) !== WebSocket.OPEN) {
			await new Promise((r) => setTimeout(r, 1000));
		}

		try {
			if (pointOffset === 0 || isResuming) {
				let dataView = new DataView(new ArrayBuffer(6));
				dataView.setUint8(0, WSCmdType_t.WSCmdType_PATTERN_START);
				dataView.setUint8(1, isResuming ? 1 : 0);
				dataView.setUint32(2, pointNums.length * 2);
				ws.send(new Uint8Array([...new Uint8Array(dataView.buffer), ...charArray, 0x00]));

				await waitForAck();
				isResuming = false;
			}

			let currentChunkSize = Math.min(nums, pointNums.length - pointOffset);
			await sendPacket(pointOffset, currentChunkSize, pointNums);

			pointOffset += currentChunkSize;
			sentPacketCount.update((n) => n + 1);
		} catch (error) {
			console.warn('Fragment failed, holding state to resume...', error);
			isResuming = true;
			await new Promise((r) => setTimeout(r, 2000));
		}
	}

	let finSent = false;
	while (!finSent) {
		try {
			ws.send(new Uint8Array([WSCmdType_t.WSCmdType_PATTERN_FIN, isCleaner ? 1 : 0]));
			await waitForAck();
			finSent = true;
		} catch (error) {
			console.warn('Finish command failed, retrying...', error);
			await new Promise((r) => setTimeout(r, 2000));
		}
	}

	sendingPattern.set(false);
}

export function sendCancelUpload() {
	ws.send(new Uint8Array([WSCmdType_t.WSCmdType_CANCEL_UPLOAD]));
	sendingPattern.set(false);
}
