import { writable } from 'svelte/store';

export type MachineStats = {
	busy: boolean;
	executing: boolean;
	homing: boolean;
	yHomed: boolean;
	homed: boolean;
	safemode: boolean;
};
export type Position = {
	x: number;
	y: number;
};
export type PatternInfo = {
	filename: string;
	type: number;
};

const defaultMachineStats: MachineStats = {
	busy: false,
	executing: false,
	homing: false,
	yHomed: false,
	homed: false,
	safemode: true
};

export const prevPosition = writable<Position>({ x: 0, y: 0 });
export const position = writable<Position>({ x: 0, y: 0 });
export const feedrate = writable<number>(2000);
export const led = writable<number>(0);
export const fan = writable<number>(0);
export const socketState = writable<number>(3);
export const espConnected = writable<boolean>(false);
export const machineStats = writable<MachineStats>(defaultMachineStats);
export const sendingPattern = writable<boolean>(false);
// Set when a pattern upload gives up after repeated failures, so the UI can
// show a clear failure instead of just quietly stopping (sendingPattern back
// to false) with no explanation. Cleared at the start of the next attempt.
export const uploadError = writable<string>('');
export const currentFile = writable<string>('');
// Byte offset of the next coordinate to be read within currentFile (4
// bytes/coordinate), or -1 if nothing is currently playing/paused.
export const patternProgress = writable<number>(-1);
export const logEnabled = writable<boolean>(true);

export const totalPacketCount = writable<number>(0);
export const sentPacketCount = writable<number>(0);

// New state for Queues & Metadata
export const machinePatterns = writable<PatternInfo[]>([]);
export const playbackMode = writable<number>(0); // 0=IDLE, 1=QUEUE, 2=SHUFFLE
// Client-only "armed" mode selection for the Queue/Shuffle radio buttons —
// these are operating modes, not action buttons; pressing Play is what
// actually starts whichever one is armed. Defaults to QUEUE.
export const armedPlaybackMode = writable<number>(1);
export const queueIndex = writable<number>(-1);
export const queue = writable<string[]>([]);
export const autoclean = writable<boolean>(true);

// Client-only: which library pattern is "armed" for manual play. Selecting a
// pattern never talks to the ESP by itself — it's just a choice for the next
// time the transport Play control is pressed.
export const selectedPattern = writable<string>('');
