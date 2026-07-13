import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	ssr: {
		// The root tarball ships this build without the workspace package manifest.
		// Bundle every Web runtime dependency so route-specific SSR never relies on
		// dependencies that npm installs only for the root package.
		noExternal: ['d3', 'marked', 'yaml']
	},
	server: {
		port: 4321
	}
});
