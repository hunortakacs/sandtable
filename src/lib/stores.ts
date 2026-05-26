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
export const currentFile = writable<string>('');
export const logEnabled = writable<boolean>(true);

export const totalPacketCount = writable<number>(0);
export const sentPacketCount = writable<number>(0);

// New state for Queues & Metadata
export const machinePatterns = writable<PatternInfo[]>([]);
export const playbackMode = writable<number>(0); // 0=IDLE, 1=QUEUE, 2=SHUFFLE
export const queueIndex = writable<number>(-1);
export const queue = writable<string[]>([]);
export const autoclean = writable<boolean>(true);
