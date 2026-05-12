import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROMPT_MARKER = "Prompts:\n\n";

export default function (pi: ExtensionAPI) {
  let pendingInputPrompt: string | undefined;
  let activePrompt: string | undefined;

  pi.on("input", (event) => {
    pendingInputPrompt = event.text;
  });

  pi.on("before_agent_start", (event) => {
    activePrompt = pendingInputPrompt ?? event.prompt;
    pendingInputPrompt = undefined;
  });

  pi.on("agent_end", async (_event, ctx) => {
    const prompt = activePrompt;
    activePrompt = undefined;

    if (!prompt) return;

    try {
      if (!(await isJjRepo(ctx.cwd))) return;
      if (!(await workingCopyHasChanges(ctx.cwd))) return;

      const currentDescription = await getCurrentDescription(ctx.cwd);
      const nextDescription = appendPrompt(currentDescription, prompt);

      if (nextDescription === currentDescription) return;

      const result = await pi.exec("jj", ["--no-pager", "describe", "--message", nextDescription], {
        timeout: 10_000,
      });

      if (result.code !== 0) {
        ctx.ui.notify(`jj prompt-description update failed: ${result.stderr || result.stdout}`, "warning");
        return;
      }

      ctx.ui.notify("Added prompt to jj change description", "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`jj prompt-description update failed: ${message}`, "warning");
    }
  });

  async function isJjRepo(cwd: string): Promise<boolean> {
    const result = await pi.exec("jj", ["--no-pager", "root"], { cwd, timeout: 5_000 });
    return result.code === 0;
  }

  async function workingCopyHasChanges(cwd: string): Promise<boolean> {
    const result = await pi.exec("jj", ["--no-pager", "--color", "never", "status"], {
      cwd,
      timeout: 10_000,
    });

    if (result.code !== 0) return false;

    return result.stdout.includes("Working copy changes:");
  }

  async function getCurrentDescription(cwd: string): Promise<string> {
    const result = await pi.exec(
      "jj",
      ["--no-pager", "log", "-r", "@", "--no-graph", "--color", "never", "-T", "description"],
      { cwd, timeout: 10_000 },
    );

    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "failed to read jj description");
    }

    return result.stdout;
  }
}

function appendPrompt(description: string, prompt: string): string {
  const quotedPrompt = prompt.split(/\r?\n/).map((line) => `> ${line}`).join("\n");

  if (!description.includes(PROMPT_MARKER)) {
    const trimmedDescription = description.trimEnd();
    return trimmedDescription ? `${trimmedDescription}\n\n${PROMPT_MARKER}${quotedPrompt}` : `${PROMPT_MARKER}${quotedPrompt}`;
  }

  return `${description.trimEnd()}\n\n${quotedPrompt}`;
}
