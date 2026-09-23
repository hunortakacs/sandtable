import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Actions } from './$types';
import { env } from '$env/dynamic/private';

export const load = (async () => {
	return {};
}) satisfies PageServerLoad;

export const actions = {
	default: async ({ cookies, request }) => {
		const data = await request.formData();
		const password = data.get('password');

		// Read at request time — see the note in the root +page.server.ts.
		const expected = env.WEBSOCKET_PASSWORD;
		if (!expected) {
			throw error(500, 'WEBSOCKET_PASSWORD is not configured');
		}

		// Strict comparison against a known-present value: `password` is null
		// when the field is missing, and `null != undefined` is false, so a
		// loose check against an unset password would have accepted an empty
		// submission outright.
		if (typeof password !== 'string' || password !== expected) {
			return fail(400, { password, incorrect: true });
		}

		cookies.set('websocket_password', password, {
			httpOnly: true,
			secure: true,
			maxAge: 60 * 60 * 24 * 30, // 1 month
			path: '/'
		});
		throw redirect(302, '/');
	}
} satisfies Actions;
