import { execFileSync } from "node:child_process";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

const EXTENSION_NAME = "jj-session-name";
const PRIMARY_BRANCH_BOOKMARK = "main";
const JJ_TIMEOUT_MS = 1000;

function runJj(cwd: string, args: string[]): string | undefined {
	try {
		return execFileSync("jj", ["--ignore-working-copy", ...args], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: JJ_TIMEOUT_MS,
		}).trim();
	} catch {
		return undefined;
	}
}

function normalizeBookmarkName(bookmark: string): string | undefined {
	const normalized = bookmark.trim().replace(/\*$/, "");
	if (!normalized || normalized === PRIMARY_BRANCH_BOOKMARK) return undefined;
	return normalized;
}

function getNearestParentBookmark(cwd: string): string | undefined {
	const output = runJj(cwd, [
		"log",
		"--no-pager",
		"--color=never",
		"--no-graph",
		"-r",
		"heads(ancestors(@-) & bookmarks())",
		"--template",
		"bookmarks",
	]);

	for (const token of output?.split(/\s+/) ?? []) {
		const bookmark = normalizeBookmarkName(token);
		if (bookmark) return bookmark;
	}

	return undefined;
}

function getCurrentChangeShortId(cwd: string): string | undefined {
	return runJj(cwd, [
		"log",
		"--no-pager",
		"--color=never",
		"--no-graph",
		"-r",
		"@",
		"--template",
		"change_id.short(8)",
	]);
}

function getJjThreadPrefix(cwd: string): string | undefined {
	return getNearestParentBookmark(cwd) ?? getCurrentChangeShortId(cwd);
}

function sanitizeNameText(text: string): string {
	return text
		.replace(/[\x00-\x1f\x7f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function hasUserMessage(entry: SessionEntry): boolean {
	return entry.type === "message" && entry.message.role === "user";
}

function isFirstUserMessage(ctx: ExtensionContext): boolean {
	return !ctx.sessionManager.getBranch().some(hasUserMessage);
}

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		if (pi.getSessionName()) return;
		if (!isFirstUserMessage(ctx)) return;

		const firstMessage = sanitizeNameText(event.prompt);
		if (!firstMessage) return;

		const prefix = getJjThreadPrefix(ctx.cwd);
		if (!prefix) return;

		try {
			pi.setSessionName(`[${prefix}]: ${firstMessage}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`${EXTENSION_NAME}: failed to set session name: ${message}`, "warning");
		}
	});
}
