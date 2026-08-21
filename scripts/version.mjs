#!/usr/bin/env node
/**
 * Single source of truth for Loudio's version across every manifest that
 * declares one. The release pipeline refuses to build when these disagree, so
 * bump them with `yarn version:set <version>` rather than by hand.
 *
 *   yarn version:check          # assert all manifests agree; print the version
 *   yarn version:set 1.1.0      # rewrite all manifests to 1.1.0
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Each target knows how to read its own version and how to rewrite it in place.
 * Rewriting is deliberately surgical — reserialising `tauri.conf.json` would
 * reformat the whole file and bury the diff.
 */
const TARGETS = [
	{
		file: "package.json",
		read: (raw) => JSON.parse(raw).version,
		write: (raw, next) =>
			raw.replace(/("version"\s*:\s*)"[^"]+"/, `$1"${next}"`),
	},
	{
		file: "src-tauri/tauri.conf.json",
		read: (raw) => JSON.parse(raw).version,
		write: (raw, next) =>
			raw.replace(/("version"\s*:\s*)"[^"]+"/, `$1"${next}"`),
	},
	{
		file: "src-tauri/Cargo.toml",
		// Only the [package] version — never a dependency's.
		read: (raw) => raw.match(/^version\s*=\s*"([^"]+)"/m)?.[1],
		write: (raw, next) =>
			raw.replace(/^(version\s*=\s*)"[^"]+"/m, `$1"${next}"`),
	},
];

// Semver with an optional dotted prerelease: 1.2.3, 1.2.3-beta.1, 1.2.3-rc.2
const SEMVER = /^\d+\.\d+\.\d+(-(alpha|beta|rc)\.\d+)?$/;

function readAll() {
	return TARGETS.map((target) => {
		const path = join(ROOT, target.file);
		const raw = readFileSync(path, "utf8");
		return { ...target, path, raw, version: target.read(raw) };
	});
}

function check() {
	const entries = readAll();
	const missing = entries.filter((entry) => !entry.version);

	if (missing.length > 0) {
		for (const entry of missing) {
			console.error(`- ${entry.file}: no version found`);
		}
		process.exit(1);
	}

	const versions = new Set(entries.map((entry) => entry.version));
	if (versions.size > 1) {
		console.error("Version mismatch across manifests:");
		for (const entry of entries) {
			console.error(`- ${entry.file}: ${entry.version}`);
		}
		console.error("\nRun `yarn version:set <version>` to realign them.");
		process.exit(1);
	}

	const [version] = versions;
	if (!SEMVER.test(version)) {
		console.error(
			`Version "${version}" is not X.Y.Z or X.Y.Z-(alpha|beta|rc).N`,
		);
		process.exit(1);
	}

	console.log(version);
}

function set(next) {
	if (!SEMVER.test(next)) {
		console.error(`Refusing to set "${next}": expected X.Y.Z or X.Y.Z-(alpha|beta|rc).N`);
		process.exit(1);
	}

	for (const entry of readAll()) {
		const updated = entry.write(entry.raw, next);
		if (updated === entry.raw && entry.version !== next) {
			console.error(`Failed to rewrite the version in ${entry.file}`);
			process.exit(1);
		}
		writeFileSync(entry.path, updated);
		console.log(`${entry.file}: ${entry.version} -> ${next}`);
	}
}

const [command, value] = process.argv.slice(2);

if (command === "--set") {
	if (!value) {
		console.error("Usage: node scripts/version.mjs --set <version>");
		process.exit(1);
	}
	set(value);
} else if (!command || command === "--check") {
	check();
} else {
	console.error(`Unknown argument: ${command}`);
	process.exit(1);
}
