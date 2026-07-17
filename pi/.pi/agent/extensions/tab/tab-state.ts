import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

interface SettledSessionState {
	settledAt: string;
	path?: string;
}

function getStateDirectory(): string {
	return join(getAgentDir(), "tab-state", "settled");
}

function getSessionStatePath(sessionId: string): string {
	return join(getStateDirectory(), `${encodeURIComponent(sessionId)}.json`);
}

export function getSettledSessionIds(): Set<string> {
	const directory = getStateDirectory();
	if (!existsSync(directory)) return new Set();

	const ids = readdirSync(directory)
		.filter((name) => name.endsWith(".json"))
		.flatMap((name) => {
			try {
				return [decodeURIComponent(name.slice(0, -".json".length))];
			} catch {
				return [];
			}
		});
	return new Set(ids);
}

export function isSessionSettled(sessionId: string): boolean {
	return existsSync(getSessionStatePath(sessionId));
}

export function setSessionSettled(sessionId: string, sessionPath: string | undefined, settled: boolean): void {
	const path = getSessionStatePath(sessionId);
	if (!settled) {
		rmSync(path, { force: true });
		return;
	}

	const directory = getStateDirectory();
	mkdirSync(directory, { recursive: true });
	const temporaryPath = join(directory, `.${randomUUID()}.tmp`);
	const state: SettledSessionState = {
		settledAt: new Date().toISOString(),
		path: sessionPath,
	};

	try {
		writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		renameSync(temporaryPath, path);
	} finally {
		rmSync(temporaryPath, { force: true });
	}
}
