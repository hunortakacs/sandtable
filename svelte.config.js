import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// Cloudflare Workers with static assets. The adapter picks up
		// wrangler.jsonc for the worker name, compatibility date and asset
		// handling; secrets come from the Worker's bindings at runtime, which is
		// why the server routes read them via $env/dynamic/private rather than
		// $env/static/private (the latter is inlined at build time, which would
		// bake the password into the deployed bundle).
		adapter: adapter()
	}
};

export default config;
