import { readFileSync } from "node:fs";
import type { SessionEntry, SessionInfo } from "@earendil-works/pi-coding-agent";
import { migrateSessionEntries, parseSessionEntries } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

export const RECENT_SESSION_LIMIT = 20;

export interface ChatMessage {
	entryId: string;
	role: "user" | "assistant";
	text: string;
	timestamp?: Date;
}

export interface ConversationData {
	activeMessages: ChatMessage[];
	allMessages: ChatMessage[];
	activeEntryIds: Set<string>;
}

export interface SearchDocument {
	session: SessionInfo;
	searchText: string;
	settled: boolean;
}

function normalizeSearchText(text: string): string {
	return text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function parseSearchTerms(query: string): string[] {
	const terms: string[] = [];
	let buffer = "";
	let quoted = false;

	const flush = () => {
		const normalized = normalizeSearchText(buffer);
		buffer = "";
		if (normalized) terms.push(normalized);
	};

	for (const character of query.trim()) {
		if (character === '"') {
			if (quoted) flush();
			else flush();
			quoted = !quoted;
			continue;
		}

		if (!quoted && /\s/.test(character)) {
			flush();
			continue;
		}

		buffer += character;
	}

	flush();
	return terms;
}

export function matchesSearchTerms(text: string, terms: readonly string[]): boolean {
	if (terms.length === 0) return true;
	const normalized = normalizeSearchText(text);
	return terms.every((term) => normalized.includes(term));
}

export function createSearchDocuments(
	sessions: readonly SessionInfo[],
	settledSessionIds: ReadonlySet<string> = new Set(),
): SearchDocument[] {
	return sessions.map((session) => ({
		session,
		searchText: normalizeSearchText(
			[session.id, session.name ?? "", session.firstMessage, session.cwd, session.allMessagesText].join(" "),
		),
		settled: settledSessionIds.has(session.id),
	}));
}

export function filterSessionDocuments(
	documents: readonly SearchDocument[],
	terms: readonly string[],
): SessionInfo[] {
	if (terms.length === 0) {
		const active = documents.filter(({ settled }) => !settled);
		const settled = documents.filter((document) => document.settled);
		return [...active, ...settled]
			.slice(0, RECENT_SESSION_LIMIT)
			.map(({ session }) => session);
	}

	return documents
		.filter(({ searchText }) => terms.every((term) => searchText.includes(term)))
		.map(({ session }) => session);
}

function extractTextContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	return content
		.flatMap((block) => {
			if (!block || typeof block !== "object") return [];
			const candidate = block as { type?: unknown; text?: unknown };
			return candidate.type === "text" && typeof candidate.text === "string" ? [candidate.text] : [];
		})
		.join("\n\n");
}

function cleanMessageText(text: string): string {
	return stripTerminalSequences(text)
		.replace(/\r\n?/g, "\n")
		.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ")
		.trim();
}

function toChatMessage(entry: SessionEntry): ChatMessage | undefined {
	if (entry.type !== "message") return undefined;
	if (entry.message.role !== "user" && entry.message.role !== "assistant") return undefined;

	const text = cleanMessageText(extractTextContent(entry.message.content));
	if (!text) return undefined;

	const messageTimestamp = "timestamp" in entry.message ? entry.message.timestamp : undefined;
	const timestampValue =
		typeof messageTimestamp === "number" ? messageTimestamp : new Date(entry.timestamp).getTime();
	const timestamp = Number.isNaN(timestampValue) ? undefined : new Date(timestampValue);

	return {
		entryId: entry.id,
		role: entry.message.role,
		text,
		timestamp,
	};
}

function getActiveBranch(entries: readonly SessionEntry[]): SessionEntry[] {
	if (entries.length === 0) return [];

	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const branch: SessionEntry[] = [];
	const visited = new Set<string>();
	let current: SessionEntry | undefined = entries.at(-1);

	while (current && !visited.has(current.id)) {
		visited.add(current.id);
		branch.push(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}

	return branch.reverse();
}

export function loadConversation(sessionPath: string): ConversationData {
	const fileEntries = parseSessionEntries(readFileSync(sessionPath, "utf8"));
	migrateSessionEntries(fileEntries);

	const entries = fileEntries.filter((entry): entry is SessionEntry => entry.type !== "session");
	const activeBranch = getActiveBranch(entries);
	const activeMessages = activeBranch.flatMap((entry) => {
		const message = toChatMessage(entry);
		return message ? [message] : [];
	});
	const allMessages = entries.flatMap((entry) => {
		const message = toChatMessage(entry);
		return message ? [message] : [];
	});

	return {
		activeMessages,
		allMessages,
		activeEntryIds: new Set(activeBranch.map((entry) => entry.id)),
	};
}
