import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);

const OWNER = "InStride-Health";
const REPO = "application";
const GH_REPO = `${OWNER}/${REPO}`;

type GhUser = {
  login?: string;
};

type PullRequestReview = {
  id?: number | string;
  author?: GhUser;
  user?: GhUser;
  state?: string;
  body?: string;
  submittedAt?: string;
  submitted_at?: string;
};

type InlineReviewComment = {
  id?: number;
  user?: GhUser;
  path?: string;
  line?: number;
  original_line?: number;
  side?: string;
  body?: string;
  html_url?: string;
  url?: string;
};

type IssueComment = {
  id?: number;
  user?: GhUser;
  body?: string;
  created_at?: string;
  html_url?: string;
};

type PullRequestView = {
  number: number;
  title: string;
  url: string;
  headRefName?: string;
  baseRefName?: string;
  reviewDecision?: string;
  author?: GhUser;
  reviews?: PullRequestReview[];
  comments?: IssueComment[];
};

async function ghJson<T>(args: string[]): Promise<T> {
  const { stdout } = await execFileAsync("gh", args, {
    maxBuffer: 20 * 1024 * 1024,
  });
  return JSON.parse(stdout) as T;
}

function normalizeLogin(value: string | undefined): string {
  return (value ?? "").toLowerCase();
}

function isCopilot(login: string | undefined): boolean {
  return normalizeLogin(login).includes("copilot");
}

function isSecurity(login: string | undefined): boolean {
  const normalized = normalizeLogin(login);
  return normalized.includes("github-advanced-security") || normalized.includes("codeql");
}

function firstLine(text: string | undefined): string {
  return (text ?? "").trim().split(/\r?\n/)[0] ?? "";
}

function formatInlineComment(comment: InlineReviewComment): string {
  const login = comment.user?.login ?? "unknown";
  const line = comment.line ?? comment.original_line ?? "?";
  const summary = firstLine(comment.body);
  const url = comment.html_url ?? comment.url ?? "";
  return `- ${login} ${comment.path ?? "unknown"}:${line}: ${summary}${url ? `\n  ${url}` : ""}`;
}

function formatIssueComment(comment: IssueComment): string {
  const login = comment.user?.login ?? "unknown";
  const summary = firstLine(comment.body);
  const url = comment.html_url ?? "";
  return `- ${login}: ${summary}${url ? `\n  ${url}` : ""}`;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "github_pr_review_context",
    label: "GitHub PR Review Context",
    description:
      "Fetch complete review feedback for a pull request in InStride-Health/application, including PR metadata, issue comments, reviews, inline review comments, Copilot comments, and security/code scanning review comments. Input is just the PR number.",
    parameters: Type.Object({
      prNumber: Type.Number({ description: "Pull request number in InStride-Health/application" }),
    }),
    async execute(_toolCallId, params) {
      const prNumber = params.prNumber;
      const pr = await ghJson<PullRequestView>([
        "pr",
        "view",
        String(prNumber),
        "--repo",
        GH_REPO,
        "--json",
        "number,title,url,headRefName,baseRefName,reviewDecision,author,reviews,comments",
      ]);

      const [inlineComments, issueComments, reviews] = await Promise.all([
        ghJson<InlineReviewComment[]>([
          "api",
          `repos/${GH_REPO}/pulls/${prNumber}/comments`,
          "--paginate",
        ]),
        ghJson<IssueComment[]>([
          "api",
          `repos/${GH_REPO}/issues/${prNumber}/comments`,
          "--paginate",
        ]),
        ghJson<PullRequestReview[]>([
          "api",
          `repos/${GH_REPO}/pulls/${prNumber}/reviews`,
          "--paginate",
        ]),
      ]);

      const allReviews = reviews.length > 0 ? reviews : pr.reviews ?? [];
      const copilotInlineComments = inlineComments.filter((comment) => isCopilot(comment.user?.login));
      const securityInlineComments = inlineComments.filter((comment) => isSecurity(comment.user?.login));
      const otherInlineComments = inlineComments.filter(
        (comment) => !isCopilot(comment.user?.login) && !isSecurity(comment.user?.login),
      );

      const text = [
        `PR #${pr.number}: ${pr.title}`,
        pr.url,
        `Branch: ${pr.headRefName ?? "?"} -> ${pr.baseRefName ?? "?"}`,
        `Review decision: ${pr.reviewDecision ?? "?"}`,
        "",
        "Counts:",
        `- Reviews: ${allReviews.length}`,
        `- Issue comments: ${issueComments.length}`,
        `- Inline review comments: ${inlineComments.length}`,
        `- Security inline comments: ${securityInlineComments.length}`,
        `- Copilot inline comments: ${copilotInlineComments.length}`,
        "",
        "Security / CodeQL inline comments:",
        ...(securityInlineComments.length > 0 ? securityInlineComments.map(formatInlineComment) : ["- None found"]),
        "",
        "Copilot inline comments:",
        ...(copilotInlineComments.length > 0 ? copilotInlineComments.map(formatInlineComment) : ["- None found"]),
        "",
        "Other inline comments:",
        ...(otherInlineComments.length > 0 ? otherInlineComments.map(formatInlineComment) : ["- None found"]),
        "",
        "Issue comments:",
        ...(issueComments.length > 0 ? issueComments.map(formatIssueComment) : ["- None found"]),
      ].join("\n");

      return {
        content: [{ type: "text", text }],
        details: {
          repo: GH_REPO,
          pr,
          reviews: allReviews,
          issueComments,
          inlineComments,
          copilotInlineComments,
          securityInlineComments,
        },
      };
    },
  });
}
