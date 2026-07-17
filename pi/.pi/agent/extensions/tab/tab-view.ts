import { homedir } from "node:os";
import { resolve } from "node:path";
import type { KeybindingsManager, SessionInfo, Theme } from "@earendil-works/pi-coding-agent";
import {
	Input,
	matchesKey,
	stripTerminalSequences,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
	type Focusable,
	type TUI,
} from "@earendil-works/pi-tui";
import {
	createSearchDocuments,
	filterSessionDocuments,
	loadConversation,
	matchesSearchTerms,
	parseSearchTerms,
	type ChatMessage,
	type ConversationData,
	type SearchDocument,
} from "./session-data.ts";

const PREVIEW_MIN_WIDTH = 104;
const SESSION_ITEM_HEIGHT = 3;

interface ConversationCacheEntry {
	data?: ConversationData;
	error?: string;
}

interface ChatRenderResult {
	lines: string[];
	firstMatchLine?: number;
}

type InteractionMode = "sessions" | "chat";

function cleanSingleLine(text: string): string {
	return stripTerminalSequences(text)
		.replace(/[\x00-\x1f\x7f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function shortenPath(path: string): string {
	const home = homedir();
	if (path === home) return "~";
	return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

function formatSessionDate(date: Date): string {
	const now = new Date();
	const includeYear = date.getFullYear() !== now.getFullYear();
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		year: includeYear ? "numeric" : undefined,
		hour: "numeric",
		minute: "2-digit",
	}).format(date);
}

function formatMessageTime(date: Date | undefined): string {
	if (!date) return "";
	return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function fitLine(line: string, width: number): string {
	const safeWidth = Math.max(1, width);
	const clipped = truncateToWidth(line, safeWidth, "");
	return clipped + " ".repeat(Math.max(0, safeWidth - visibleWidth(clipped)));
}

function joinEnds(left: string, right: string, width: number): string {
	const safeRight = truncateToWidth(right, Math.max(0, width - 1), "");
	const availableLeft = Math.max(0, width - visibleWidth(safeRight) - 1);
	const safeLeft = truncateToWidth(left, availableLeft, "");
	const gap = Math.max(1, width - visibleWidth(safeLeft) - visibleWidth(safeRight));
	return truncateToWidth(`${safeLeft}${" ".repeat(gap)}${safeRight}`, width, "");
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightMatches(text: string, terms: readonly string[], theme: Theme): string {
	if (terms.length === 0) return text;
	const alternatives = [...terms]
		.filter(Boolean)
		.sort((a, b) => b.length - a.length)
		.map(escapeRegExp);
	if (alternatives.length === 0) return text;

	const pattern = new RegExp(`(${alternatives.join("|")})`, "giu");
	return text.replace(pattern, (match) =>
		theme.bg("searchMatchBg", theme.fg("searchMatchText", match)),
	);
}

function wrapHighlightedText(
	text: string,
	width: number,
	terms: readonly string[],
	theme: Theme,
): string[] {
	const lines: string[] = [];
	for (const sourceLine of text.split("\n")) {
		if (!sourceLine) {
			lines.push("");
			continue;
		}
		const highlighted = highlightMatches(sourceLine, terms, theme);
		lines.push(...wrapTextWithAnsi(highlighted, Math.max(1, width)));
	}
	return lines;
}

function renderMessage(
	message: ChatMessage,
	width: number,
	terms: readonly string[],
	theme: Theme,
): string[] {
	const role = message.role === "user" ? "You" : "Agent";
	const time = formatMessageTime(message.timestamp);
	const label = time ? `${role} · ${time}` : role;
	const labelColor = message.role === "user" ? "accent" : "muted";
	const lines = [theme.bold(theme.fg(labelColor, label))];
	const bodyWidth = Math.max(1, width - 2);
	const bodyLines = wrapHighlightedText(message.text, bodyWidth, terms, theme);

	for (const bodyLine of bodyLines) {
		const padded = fitLine(` ${bodyLine}`, width);
		lines.push(message.role === "user" ? theme.bg("userMessageBg", padded) : padded);
	}
	lines.push("");
	return lines;
}

export class TabView implements Component, Focusable {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly keybindings: KeybindingsManager;
	private readonly done: (sessionPath: string | null) => void;
	private readonly documents: SearchDocument[];
	private readonly settledSessionIds: ReadonlySet<string>;
	private readonly currentSessionPath?: string;
	private readonly searchInput = new Input();
	private readonly conversationCache = new Map<string, ConversationCacheEntry>();
	private filteredSessions: SessionInfo[];
	private selectedIndex = 0;
	private terms: string[] = [];
	private previewScrollTop: number | undefined;
	private previewMaxScroll = 0;
	private previewViewportHeight = 0;
	private previewVisible = false;
	private interactionMode: InteractionMode = "sessions";
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value && this.interactionMode === "sessions";
	}

	constructor(options: {
		tui: TUI;
		theme: Theme;
		keybindings: KeybindingsManager;
		sessions: SessionInfo[];
		settledSessionIds: ReadonlySet<string>;
		currentSessionPath?: string;
		done: (sessionPath: string | null) => void;
	}) {
		this.tui = options.tui;
		this.theme = options.theme;
		this.keybindings = options.keybindings;
		this.done = options.done;
		this.settledSessionIds = options.settledSessionIds;
		this.documents = createSearchDocuments(options.sessions, options.settledSessionIds);
		this.filteredSessions = filterSessionDocuments(this.documents, []);
		this.currentSessionPath = options.currentSessionPath
			? resolve(options.currentSessionPath)
			: undefined;
	}

	private get selectedSession(): SessionInfo | undefined {
		return this.filteredSessions[this.selectedIndex];
	}

	private setInteractionMode(mode: InteractionMode): void {
		if (mode === "chat" && !this.previewVisible) return;
		this.interactionMode = mode;
		this.searchInput.focused = this._focused && mode === "sessions";
	}

	private updateFilter(): void {
		this.terms = parseSearchTerms(this.searchInput.getValue());
		this.filteredSessions = filterSessionDocuments(this.documents, this.terms);
		this.selectedIndex = 0;
		this.previewScrollTop = undefined;
	}

	private moveSelection(delta: number): void {
		if (this.filteredSessions.length === 0) return;
		this.selectedIndex = Math.max(
			0,
			Math.min(this.filteredSessions.length - 1, this.selectedIndex + delta),
		);
		this.previewScrollTop = undefined;
	}

	private scrollPreview(delta: number): void {
		if (!this.previewVisible || this.previewMaxScroll === 0) return;
		const start = this.previewScrollTop ?? this.previewMaxScroll;
		this.previewScrollTop = Math.max(0, Math.min(this.previewMaxScroll, start + delta));
	}

	private getConversation(path: string): ConversationCacheEntry {
		const cached = this.conversationCache.get(path);
		if (cached) return cached;

		let entry: ConversationCacheEntry;
		try {
			entry = { data: loadConversation(path) };
		} catch (error) {
			entry = { error: error instanceof Error ? error.message : String(error) };
		}
		this.conversationCache.set(path, entry);
		return entry;
	}

	handleInput(data: string): void {
		const lineStep = 3;
		const pageStep = Math.max(4, Math.floor(this.previewViewportHeight * 0.7));
		const pageUp = this.keybindings.matches(data, "tui.select.pageUp");
		const pageDown = this.keybindings.matches(data, "tui.select.pageDown");

		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.done(null);
			return;
		}

		if (this.keybindings.matches(data, "tui.input.tab")) {
			this.setInteractionMode(this.interactionMode === "sessions" ? "chat" : "sessions");
		} else if (this.keybindings.matches(data, "tui.select.confirm")) {
			const selected = this.selectedSession;
			if (selected) this.done(selected.path);
			return;
		} else if (
			pageUp ||
			matchesKey(data, "shift+up") ||
			matchesKey(data, "ctrl+up") ||
			(this.interactionMode === "chat" &&
				(this.keybindings.matches(data, "tui.select.up") || matchesKey(data, "k")))
		) {
			this.scrollPreview(pageUp ? -pageStep : -lineStep);
		} else if (
			pageDown ||
			matchesKey(data, "shift+down") ||
			matchesKey(data, "ctrl+down") ||
			(this.interactionMode === "chat" &&
				(this.keybindings.matches(data, "tui.select.down") || matchesKey(data, "j")))
		) {
			this.scrollPreview(pageDown ? pageStep : lineStep);
		} else if (
			this.interactionMode === "sessions" &&
			this.keybindings.matches(data, "tui.select.up")
		) {
			this.moveSelection(-1);
		} else if (
			this.interactionMode === "sessions" &&
			this.keybindings.matches(data, "tui.select.down")
		) {
			this.moveSelection(1);
		} else {
			const previousQuery = this.searchInput.getValue();
			this.searchInput.handleInput(data);
			if (this.searchInput.getValue() !== previousQuery) {
				this.setInteractionMode("sessions");
				this.updateFilter();
			}
		}

		this.tui.requestRender();
	}

	private renderSidebar(width: number, height: number): string[] {
		const lines: string[] = [];
		const total = this.documents.length;
		const visibleTotal = this.filteredSessions.length;
		const activeTotal = this.documents.filter(({ settled }) => !settled).length;
		const settledTotal = total - activeTotal;
		const queryActive = this.terms.length > 0;
		const heading = queryActive
			? `${visibleTotal} match${visibleTotal === 1 ? "" : "es"}`
			: `${activeTotal} active · ${settledTotal} settled`;
		const selectedPosition = visibleTotal === 0 ? "" : `${this.selectedIndex + 1}/${visibleTotal}`;
		const headingColor = this.interactionMode === "sessions" ? "accent" : "muted";
		lines.push(
			joinEnds(
				this.theme.bold(this.theme.fg(headingColor, `Conversations · ${heading}`)),
				this.theme.fg("dim", selectedPosition),
				width,
			),
		);

		if (visibleTotal === 0) {
			lines.push(this.theme.fg("muted", fitLine("No conversations match this search.", width)));
			while (lines.length < height) lines.push(" ".repeat(width));
			return lines.slice(0, height);
		}

		const maxVisible = Math.max(1, Math.floor((height - 1) / SESSION_ITEM_HEIGHT));
		const startIndex = Math.max(
			0,
			Math.min(
				this.selectedIndex - Math.floor(maxVisible / 2),
				Math.max(0, visibleTotal - maxVisible),
			),
		);
		const endIndex = Math.min(visibleTotal, startIndex + maxVisible);

		for (let index = startIndex; index < endIndex; index++) {
			const session = this.filteredSessions[index]!;
			const selected = index === this.selectedIndex;
			const current = this.currentSessionPath === resolve(session.path);
			const settled = this.settledSessionIds.has(session.id);
			const rawTitle = cleanSingleLine(session.name ?? session.firstMessage) || "(no messages)";
			const title = highlightMatches(rawTitle, this.terms, this.theme);
			const cwd = highlightMatches(shortenPath(session.cwd || "(unknown directory)"), this.terms, this.theme);
			const metadata = [
				current ? this.theme.fg("success", "● current") : undefined,
				settled ? this.theme.fg("muted", "✓ settled") : undefined,
				this.theme.fg("muted", formatSessionDate(session.modified)),
			]
				.filter((part): part is string => Boolean(part))
				.join(this.theme.fg("dim", " · "));
			const itemLines = [
				title,
				`  ${metadata}`,
				`  ${this.theme.fg("dim", cwd)}`,
			];

			for (const itemLine of itemLines) {
				const fitted = fitLine(itemLine, width);
				lines.push(selected ? this.theme.bg("selectedBg", fitted) : fitted);
			}
		}

		while (lines.length < height) lines.push(" ".repeat(width));
		return lines.slice(0, height);
	}

	private buildChatLines(conversation: ConversationData, width: number): ChatRenderResult {
		const lines: string[] = [];
		let firstMatchLine: number | undefined;
		const activeBranchMatches = matchesSearchTerms(
			conversation.activeMessages.map((message) => message.text).join(" "),
			this.terms,
		);
		const outsideMatches = conversation.allMessages.filter(
			(message) =>
				!conversation.activeEntryIds.has(message.entryId) &&
				this.terms.some((term) => matchesSearchTerms(message.text, [term])),
		);

		if (this.terms.length > 0 && !activeBranchMatches && outsideMatches.length > 0) {
			lines.push(
				this.theme.fg("warning", "Match found on another branch. Resume this session, then use /tree."),
				"",
			);
			for (const match of outsideMatches.slice(0, 2)) {
				lines.push(...renderMessage(match, width, this.terms, this.theme));
			}
			lines.push(this.theme.fg("borderMuted", "─".repeat(Math.max(1, width))), "");
		} else if (this.terms.length > 0 && !activeBranchMatches && outsideMatches.length === 0) {
			lines.push(
				this.theme.fg("muted", "Search matched this session's title, ID, or directory."),
				"",
			);
		}

		for (const message of conversation.activeMessages) {
			if (
				firstMatchLine === undefined &&
				this.terms.some((term) => matchesSearchTerms(message.text, [term]))
			) {
				firstMatchLine = lines.length;
			}
			lines.push(...renderMessage(message, width, this.terms, this.theme));
		}

		if (conversation.activeMessages.length === 0) {
			lines.push(this.theme.fg("muted", "No user or assistant text in this session."));
		}

		return { lines, firstMatchLine };
	}

	private renderPreview(width: number, height: number): string[] {
		const selected = this.selectedSession;
		if (!selected) return Array.from({ length: height }, () => " ".repeat(width));

		const title = cleanSingleLine(selected.name ?? selected.firstMessage) || "(no messages)";
		const chatLabelColor = this.interactionMode === "chat" ? "accent" : "muted";
		const chatLabel = this.theme.fg(chatLabelColor, "Chat");
		const headerLines = [
			truncateToWidth(
				this.theme.bold(`${chatLabel} · ${highlightMatches(title, this.terms, this.theme)}`),
				width,
				"…",
			),
			truncateToWidth(
				this.theme.fg(
					"dim",
					`${formatSessionDate(selected.modified)} · ${shortenPath(selected.cwd || "(unknown directory)")}`,
				),
				width,
				"…",
			),
			this.theme.fg("borderMuted", "─".repeat(Math.max(1, width))),
		];
		const bodyHeight = Math.max(1, height - headerLines.length);
		const cached = this.getConversation(selected.path);

		if (cached.error || !cached.data) {
			const error = this.theme.fg("error", `Could not open session: ${cached.error ?? "unknown error"}`);
			const body = [truncateToWidth(error, width, "…")];
			while (body.length < bodyHeight) body.push(" ".repeat(width));
			this.previewMaxScroll = 0;
			this.previewViewportHeight = bodyHeight;
			return [...headerLines, ...body.slice(0, bodyHeight)];
		}

		const rendered = this.buildChatLines(cached.data, width);
		this.previewViewportHeight = bodyHeight;
		this.previewMaxScroll = Math.max(0, rendered.lines.length - bodyHeight);

		if (this.previewScrollTop === undefined) {
			this.previewScrollTop =
				this.terms.length > 0 && rendered.firstMatchLine !== undefined
					? Math.max(0, Math.min(this.previewMaxScroll, rendered.firstMatchLine - 1))
					: this.previewMaxScroll;
		}
		this.previewScrollTop = Math.max(0, Math.min(this.previewMaxScroll, this.previewScrollTop));

		const body = rendered.lines
			.slice(this.previewScrollTop, this.previewScrollTop + bodyHeight)
			.map((line) => fitLine(line, width));
		while (body.length < bodyHeight) body.push(" ".repeat(width));

		if (this.previewMaxScroll > 0 && body.length > 0) {
			const position = `${this.previewScrollTop + 1}-${Math.min(
				this.previewScrollTop + bodyHeight,
				rendered.lines.length,
			)}/${rendered.lines.length}`;
			body[body.length - 1] = joinEnds(
				body[body.length - 1]!,
				this.theme.fg("dim", position),
				width,
			);
		}

		return [...headerLines, ...body].slice(0, height);
	}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width);
		const targetHeight = Math.max(8, this.tui.terminal.rows - 2);
		const bodyHeight = Math.max(3, targetHeight - 4);
		this.previewVisible = safeWidth >= PREVIEW_MIN_WIDTH;
		if (!this.previewVisible && this.interactionMode === "chat") {
			this.setInteractionMode("sessions");
		}

		const title = this.theme.bold(this.theme.fg("accent", "tab"));
		const subtitle = this.theme.fg("muted", "recent conversations across all directories");
		const totalLabel = this.theme.fg("dim", `${this.documents.length} total`);
		const titleLine = joinEnds(`${title}  ${subtitle}`, totalLabel, safeWidth);
		const searchLabel = this.theme.fg("muted", "Search ");
		const inputWidth = Math.max(3, safeWidth - visibleWidth(searchLabel));
		const searchLine = truncateToWidth(
			`${searchLabel}${this.searchInput.render(inputWidth)[0] ?? ""}`,
			safeWidth,
			"",
		);
		const divider = this.theme.fg("border", "─".repeat(safeWidth));

		let body: string[];
		if (this.previewVisible) {
			const sidebarWidth = Math.min(46, Math.max(36, Math.floor(safeWidth * 0.36)));
			const previewWidth = Math.max(1, safeWidth - sidebarWidth - 1);
			const sidebar = this.renderSidebar(sidebarWidth, bodyHeight);
			const preview = this.renderPreview(previewWidth, bodyHeight);
			const dividerColor = this.interactionMode === "chat" ? "borderAccent" : "borderMuted";
			const columnDivider = this.theme.fg(dividerColor, "│");
			body = Array.from({ length: bodyHeight }, (_, index) =>
				truncateToWidth(
					`${fitLine(sidebar[index] ?? "", sidebarWidth)}${columnDivider}${fitLine(
						preview[index] ?? "",
						previewWidth,
					)}`,
					safeWidth,
					"",
				),
			);
		} else {
			this.previewMaxScroll = 0;
			this.previewViewportHeight = 0;
			body = this.renderSidebar(safeWidth, bodyHeight);
		}

		let footerText: string;
		if (!this.previewVisible) {
			footerText = "type to search · ↑↓ sessions · enter resume · esc close";
		} else if (this.interactionMode === "chat") {
			footerText = "chat focused · ↑↓ or j/k scroll · fn+↑↓ page · tab sessions · enter resume · esc close";
		} else {
			footerText = "type to search · ↑↓ sessions · tab focus chat · enter resume · esc close";
		}
		const footer = this.theme.fg("dim", truncateToWidth(footerText, safeWidth, "…"));

		return [titleLine, searchLine, divider, ...body, footer];
	}

	invalidate(): void {
		this.searchInput.invalidate();
	}
}
