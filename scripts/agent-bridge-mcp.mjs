#!/usr/bin/env node
/**
 * MCP server exposing a running Loudio dev build to AI coding agents.
 *
 * Speaks JSON-RPC over stdio, so any MCP client — Claude Code, Cursor,
 * Antigravity — sees the running app as a set of tools rather than as an HTTP
 * endpoint it has to be taught about.
 *
 * The protocol is implemented directly rather than via the MCP SDK: the surface
 * needed here is `initialize`, `tools/list` and `tools/call`, and a dependency
 * added for that would be installed by everyone who checks out the repo.
 *
 * Connection details come from the handshake file the app writes at startup.
 * That file only exists while a *development* build is running — the bridge is
 * compiled out of release builds — so this server is inert against a packaged
 * app by construction.
 */

import { readFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const BUNDLE_ID = "io.github.sudsarkar13.loudio";

function handshakePath() {
	if (platform() === "darwin") {
		return join(
			homedir(),
			"Library",
			"Application Support",
			BUNDLE_ID,
			"agent-bridge.json",
		);
	}
	const xdg = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
	return join(xdg, BUNDLE_ID, "agent-bridge.json");
}

/**
 * Read fresh on every call rather than cached: the port and token change each
 * time the app restarts, which during development is constantly. Caching would
 * make the server work until the first reload and then fail confusingly.
 */
async function handshake() {
	try {
		return JSON.parse(await readFile(handshakePath(), "utf8"));
	} catch {
		throw new Error(
			"Loudio does not appear to be running in development mode. " +
				"Start it with `yarn tauri dev` and try again.",
		);
	}
}

async function bridge(method, path, body) {
	const { port, token } = await handshake();
	const response = await fetch(`http://127.0.0.1:${port}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			...(body ? { "Content-Type": "application/json" } : {}),
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	});

	const text = await response.text();
	if (!response.ok) {
		throw new Error(`Bridge returned ${response.status}: ${text}`);
	}
	return text;
}

const TOOLS = [
	{
		name: "loudio_health",
		description:
			"Check whether a Loudio development build is running, and report its version, platform and pid.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "loudio_state",
		description:
			"Read the running app's live UI state: window mode (compact/general), recording and transcribing status, current transcript, selected audio file, active view, and all settings.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "loudio_logs",
		description:
			"Read the tail of Loudio's diagnostic log. Every entry is stamped with the window mode, page visibility and focus, which is what makes a microphone failure traceable to the mode it happened in.",
		inputSchema: {
			type: "object",
			properties: {
				limit: {
					type: "number",
					description: "Maximum bytes to return (default 65536).",
				},
			},
		},
	},
	{
		name: "loudio_screenshot",
		description:
			"Capture the running app window to a PNG and return its path, so the UI can be inspected rather than inferred from source.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "loudio_invoke",
		description:
			"Drive the running app through a whitelisted UI action, for automated UX testing.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: [
						"start_recording",
						"stop_recording",
						"toggle_compact_mode",
						"set_compact_mode",
						"transcribe_file",
						"clear_transcript",
						"update_settings",
						"select_view",
					],
				},
				args: {
					type: "object",
					description:
						"Action arguments, e.g. {compact: true}, {path: '/tmp/a.wav'}, {view: 'history'}, or a settings patch.",
				},
			},
			required: ["action"],
		},
	},
	{
		name: "loudio_run_tests",
		description:
			"Run one of the project's checks and return its output: 'rust' (cargo test), 'types' (tsc --noEmit) or 'build' (next build).",
		inputSchema: {
			type: "object",
			properties: {
				suite: { type: "string", enum: ["rust", "types", "build"] },
			},
			required: ["suite"],
		},
	},
];

async function callTool(name, args = {}) {
	switch (name) {
		case "loudio_health":
			return bridge("GET", "/health");
		case "loudio_state":
			return bridge("GET", "/state");
		case "loudio_logs":
			return bridge("GET", `/logs?limit=${Number(args.limit) || 65536}`);
		case "loudio_screenshot":
			return bridge("POST", "/screenshot", {});
		case "loudio_invoke":
			return bridge("POST", "/invoke", {
				action: args.action,
				args: args.args ?? {},
			});
		case "loudio_run_tests":
			return bridge("POST", "/tests", { suite: args.suite });
		default:
			throw new Error(`Unknown tool: ${name}`);
	}
}

function send(message) {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(request) {
	const { id, method, params } = request;

	// Notifications carry no id and must not be answered.
	if (id === undefined) return;

	try {
		switch (method) {
			case "initialize":
				return send({
					jsonrpc: "2.0",
					id,
					result: {
						protocolVersion: "2024-11-05",
						capabilities: { tools: {} },
						serverInfo: { name: "loudio-agent-bridge", version: "1.0.0" },
					},
				});

			case "tools/list":
				return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });

			case "tools/call": {
				const text = await callTool(params?.name, params?.arguments ?? {});
				return send({
					jsonrpc: "2.0",
					id,
					result: { content: [{ type: "text", text }] },
				});
			}

			case "ping":
				return send({ jsonrpc: "2.0", id, result: {} });

			default:
				return send({
					jsonrpc: "2.0",
					id,
					error: { code: -32601, message: `Method not found: ${method}` },
				});
		}
	} catch (error) {
		// Reported as a tool result rather than a transport error: "the app is
		// not running" is information the agent should act on, not a crash.
		if (method === "tools/call") {
			return send({
				jsonrpc: "2.0",
				id,
				result: {
					content: [{ type: "text", text: String(error.message ?? error) }],
					isError: true,
				},
			});
		}
		send({
			jsonrpc: "2.0",
			id,
			error: { code: -32603, message: String(error.message ?? error) },
		});
	}
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
	const trimmed = line.trim();
	if (!trimmed) return;
	let request;
	try {
		request = JSON.parse(trimmed);
	} catch {
		return;
	}
	void handle(request);
});
