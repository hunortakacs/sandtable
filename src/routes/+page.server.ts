import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { error, redirect } from '@sveltejs/kit';

// Which relay to talk to. Configurable so moving the relay (or failing back to
// the old one) is an environment change rather than a code change and redeploy.
const DEFAULT_RELAY_URL = 'wss://sandtable-relay.tahun.dev';

export const load = (async ({ cookies }) => {
	// Read at request time, not build time: on Cloudflare these come from the
	// Worker's bindings, and $env/static/private would inline them into the
	// deployed bundle instead.
	const expected = env.WEBSOCKET_PASSWORD;
	if (!expected) {
		// Fail closed. With this unset, a loose comparison against an undefined
		// value is the kind of thing that quietly lets everyone in.
		throw error(500, 'WEBSOCKET_PASSWORD is not configured');
	}

	const websocket_password = cookies.get('websocket_password') || '';
	if (websocket_password !== expected) {
		throw redirect(302, '/auth');
	}

	const patterns = import.meta.glob('/static/patterns/*.gcode');

	const patternNames = Object.keys(patterns).map((filePath) =>
		filePath.replace('/static/patterns/', '')
	);

	return {
		patterns: patternNames,
		websocket_password,
		relay_url: env.RELAY_URL || DEFAULT_RELAY_URL
	};
}) satisfies PageServerLoad;
