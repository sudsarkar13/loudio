/** @type {import('next').NextConfig} */
const nextConfig = {
	typedRoutes: true,
	output: "export",
	trailingSlash: true,
	transpilePackages: [
		"@tauri-apps/api",
		"@tauri-apps/plugin-clipboard-manager",
		"@tauri-apps/plugin-dialog",
		"@tauri-apps/plugin-fs",
	],
	images: {
		unoptimized: true,
	},
};

export default nextConfig;
