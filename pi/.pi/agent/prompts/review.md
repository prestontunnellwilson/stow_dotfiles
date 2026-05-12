---
description: Spawn a read-only Pi sub-agent to review local jj work
argument-hint: "[--provider <provider>] [--model <model>] [--end <jj revset>] [review instructions]"
---

Spawn yourself as a sub-agent via `bash` to do a code review: $@

Do not read the code yourself and do not inspect `jj diff` hunks yourself. Let the sub-agent inspect the diff and any relevant files. You may use `jj` only for lightweight metadata needed to choose the review range, identify changed files for pre-commit, and decide whether pre-commit should run.

Workflow:

1. Identify the end change to review from the prompt arguments.
   - If the user specified `--end <jj revset>`, use that revset as the end change.
   - Otherwise, fall back to `@`.
   - When forwarding review instructions to the sub-agent, omit the `--end <jj revset>` selector itself.
2. Identify the comparison base with non-interactive `jj` commands, using the fork point of the end change and the current trunk so the review is stable even if `main`/trunk has moved since the work began:
   - Use `jj --no-pager` for all `jj` commands you run directly.
   - Preferred base revset: `fork_point(trunk() | <end-change>)`
   - The sub-agent should review with `jj --no-pager diff --from 'fork_point(trunk() | <end-change>)' --to '<end-change>'`.
3. Identify changed files for pre-commit without inspecting diff hunks.
   - Prefer `jj --no-pager diff --name-only --from 'fork_point(trunk() | <end-change>)' --to '<end-change>'` for the file list.
   - Do not use unsupported commands like `jj status --rev`; `jj status` does not take `--rev`.
4. Run pre-commit hooks before spawning the reviewer:
   - Prefer `pre-commit run --hook-stage push --files <representative changed files...>`.
   - Use a sizable timeout for pre-commit because hook-stage push may run Go tests or other integration-heavy checks. In this repository, some service tests can legitimately take 30+ seconds, so allow at least 10 minutes before declaring the command timed out.
   - If pre-commit itself reports a test timeout, mention that separately from a harness/command timeout. When practical, note whether the failure may be due to an undersized test timeout rather than a deterministic test failure.
   - If pre-commit fails or times out, continue to the review but include that result in the final report.
5. Spawn the sub-agent with `pi --print` from the repository/worktree directory.
   - Give it read-only review tools: `--tools read,bash,grep,find,ls`.
   - If the user specified a provider/model in `$@`, pass them using `--provider` and/or `--model` as appropriate.
6. Pass the sub-agent a prompt instructing it to:
   - Review `jj --no-pager diff --from 'fork_point(trunk() | <end-change>)' --to '<end-change>'`.
   - Inspect relevant files as needed, but make no edits.
   - Focus on:
     - Bugs and logic errors
     - Security issues
     - Error handling gaps
     - Whether the changed code makes sense where it lives
   - For code-placement review, explicitly double-check locality and colocation:
     - Would the changed behavior be easier to understand and maintain if it lived in a consumer instead of the current module?
     - Would it be clearer in a parent or sibling function, class, file, or package/module?
     - Could we simplify consumers' usage by moving more functionality within the interface's functionality and deepening our modules?
     - Prefer colocating related behavior so human engineers and LLM-based coding agents can understand the change locally.
     - Call out opportunities to separate side effects from main logic so the core behavior is easier to test and integrations are easier to scan.
   - Ignore purely stylistic issues unless they hide a real defect or materially harm locality/scannability.
   - Return findings with file paths, line numbers where possible, severity, rationale, and suggested fixes.
   - Explicitly say if no issues are found.
7. Report the sub-agent's findings to the user, along with the pre-commit result if it was run or skipped.
