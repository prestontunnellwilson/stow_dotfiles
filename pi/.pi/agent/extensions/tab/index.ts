import { resolve } from "node:path";
import {
	SessionManager,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type SessionInfo,
} from "@earendil-works/pi-coding-agent";
import { getSettledSessionIds, isSessionSettled, setSessionSettled } from "./tab-state.ts";
import { TabView } from "./tab-view.ts";

function updateCurrentSessionSettlement(
	ctx: ExtensionCommandContext,
	settled: boolean,
): boolean {
	const sessionPath = ctx.sessionManager.getSessionFile();
	if (!sessionPath) {
		ctx.ui.notify("This conversation has not been saved yet", "warning");
		return false;
	}

	try {
		setSessionSettled(ctx.sessionManager.getSessionId(), sessionPath, settled);
		ctx.ui.notify(settled ? "Conversation marked settled" : "Conversation marked active", "info");
		return true;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`Could not update conversation status: ${message}`, "error");
		return false;
	}
}

export default function tabExtension(pi: ExtensionAPI) {
	pi.registerCommand("tab", {
		description: "Browse and search recent conversations with a chat preview",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/tab requires interactive mode", "error");
				return;
			}

			ctx.ui.notify("Loading conversations…", "info");

			let sessions: SessionInfo[];
			try {
				sessions = await SessionManager.listAll();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Could not load conversations: ${message}`, "error");
				return;
			}

			if (sessions.length === 0) {
				ctx.ui.notify("No saved conversations found", "warning");
				return;
			}

			const currentSessionPath = ctx.sessionManager.getSessionFile();
			const settledSessionIds = getSettledSessionIds();
			const selectedPath = await ctx.ui.custom<string | null>((tui, theme, keybindings, done) =>
				new TabView({
					tui,
					theme,
					keybindings,
					sessions,
					settledSessionIds,
					currentSessionPath,
					done,
				}),
			);

			if (!selectedPath) return;
			if (currentSessionPath && resolve(currentSessionPath) === resolve(selectedPath)) return;

			await ctx.waitForIdle();
			const result = await ctx.switchSession(selectedPath);
			if (result.cancelled) {
				ctx.ui.notify("Session switch cancelled", "info");
			}
		},
	});

	pi.registerCommand("settle", {
		description: "Mark this conversation settled (use /settle active to undo)",
		handler: async (args, ctx) => {
			const action = args.trim().toLocaleLowerCase();
			if (action === "status") {
				const settled = isSessionSettled(ctx.sessionManager.getSessionId());
				ctx.ui.notify(`Conversation is ${settled ? "settled" : "active"}`, "info");
				return;
			}

			const markActive = ["active", "open", "reopen", "undo", "clear"].includes(action);
			await ctx.waitForIdle();
			updateCurrentSessionSettlement(ctx, !markActive);
		},
	});

	pi.registerCommand("end", {
		description: "Mark this conversation settled",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();
			updateCurrentSessionSettlement(ctx, true);
		},
	});

	pi.registerCommand("unsettle", {
		description: "Mark this conversation active again",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();
			updateCurrentSessionSettlement(ctx, false);
		},
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		if (!isSessionSettled(sessionId)) return;

		try {
			setSessionSettled(sessionId, ctx.sessionManager.getSessionFile(), false);
			ctx.ui.notify("Conversation reopened because it received a new message", "info");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Could not reopen conversation: ${message}`, "warning");
		}
	});
}
