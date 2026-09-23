// Shared behaviour for the three machine sliders (LED, fan, feedrate).
//
// They all have the same problem: an `oninput` handler fires continuously while
// you drag, and every one of those events used to become a websocket message —
// which on the ESP meant a full config.cfg flash rewrite, performed on the
// websocket client's task while holding that client's lock. The slider felt
// unusable because it was, quite literally, waiting on flash.
//
// The fix has two halves. The firmware now defers persisting (see
// FileHandler::markConfigDirty), and this rate-limits what goes on the wire
// while still feeling live: the first move is sent immediately, moves after
// that at most every `intervalMs`, and the value you release on is always sent.

export function createThrottledSender(send: (value: number) => void, intervalMs = 70) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pending: number | null = null;
	let lastSentAt = 0;

	function flush() {
		timer = null;
		if (pending === null) return;
		const value = pending;
		pending = null;
		lastSentAt = Date.now();
		send(value);
	}

	return {
		// While dragging: leading edge, then at most one send per interval.
		push(value: number) {
			pending = value;
			const elapsed = Date.now() - lastSentAt;
			if (elapsed >= intervalMs) {
				flush();
			} else if (!timer) {
				timer = setTimeout(flush, intervalMs - elapsed);
			}
		},
		// On release, or from the number input: this exact value must land, and
		// must not be overtaken by a throttled one that's still queued.
		commit(value: number) {
			pending = value;
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			flush();
		}
	};
}

// Decides whether the slider should adopt the value the machine is reporting.
//
// The machine echoes its state back continuously, and naively following that
// echo is what made a slider snap back out from under you: you let go, the next
// stale echo arrived, and the thumb jumped to where the machine was a moment
// ago. So once we've sent a value we stop following the echo until the machine
// confirms that exact value — at which point the two agree and tracking resumes.
//
// The timeout is the escape hatch: if the command was dropped and the
// confirmation never comes, the slider resyncs rather than staying stuck.
export function createEchoGate(timeoutMs = 3000) {
	let awaiting: number | null = null;
	let awaitingSince = 0;

	return {
		// Call whenever a value is sent to the machine.
		sent(value: number) {
			awaiting = value;
			awaitingSince = Date.now();
		},
		// True when the reported value should be displayed.
		accepts(reported: number) {
			if (awaiting === null) return true;
			if (reported === awaiting) {
				awaiting = null;
				return true;
			}
			if (Date.now() - awaitingSince > timeoutMs) {
				awaiting = null;
				return true;
			}
			return false;
		}
	};
}
