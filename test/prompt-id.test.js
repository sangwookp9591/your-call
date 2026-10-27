import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeProjectDir, readLedger, runHook } from "./helpers.js";

/** 각 hook이 한 줄 이상 남기는 입력. 모두 같은 prompt_id를 싣는다. */
function inputsFor(/** @type {string} */ projectDir, /** @type {Record<string, unknown>} */ promptId) {
  const transcript = join(projectDir, "transcript.jsonl");
  writeFileSync(transcript, `${JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "[Request interrupted by user]" }] }, timestamp: "2026-10-27T10:00:00.000Z" })}\n`);
  const base = { session_id: "s-pc", ...promptId };
  const question = { question: "어느 쪽?", header: "선택", multiSelect: false, options: [{ label: "A" }, { label: "B" }] };
  return {
    "ledger-open": { ...base, hook_event_name: "SessionStart", source: "startup" },
    "prompt-capture": { ...base, hook_event_name: "UserPromptSubmit", prompt: "why: 묶어 보기" },
    "intent-capture": { ...base, hook_event_name: "UserPromptSubmit", prompt: "why: 묶어 보기" },
    "interrupt-capture": { ...base, hook_event_name: "UserPromptSubmit", prompt: "다음", transcript_path: transcript },
    "choice-capture": { ...base, hook_event_name: "PostToolUse", tool_name: "AskUserQuestion", tool_input: { questions: [question] }, tool_response: { answers: { "어느 쪽?": "A" } } },
    "skill-capture": { ...base, hook_event_name: "PostToolUse", tool_name: "Skill", tool_input: { skill: "dataviz" } },
    "agent-capture": { ...base, hook_event_name: "PostToolUse", tool_name: "Agent", tool_input: { description: "조사", prompt: "조사해 줘" } },
    "edit-capture": { ...base, hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.ts" } },
    "turn-close": { ...base, hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "끝" },
    "ledger-guard": { ...base, hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: ".your-call/ledger/x.jsonl" }, cwd: projectDir },
  };
}

test("PC1: 기록 hook과 guard가 남기는 모든 줄에 hook 입력의 prompt_id가 들어간다", () => {
  const projectDir = makeProjectDir();
  mkdirSync(join(projectDir, ".your-call", "ledger"), { recursive: true });

  for (const [hook, input] of Object.entries(inputsFor(projectDir, { prompt_id: "pr-pc" }))) {
    runHook(hook, { stdin: JSON.stringify(input), projectDir });
  }

  const lines = readLedger(projectDir, "s-pc");
  assert.deepEqual(
    [...new Set(lines.map((line) => line.by))].sort(),
    ["agent-capture", "choice-capture", "edit-capture", "intent-capture", "interrupt-capture", "ledger-guard", "ledger-open", "prompt-capture", "skill-capture", "turn-close"],
  );
  for (const line of lines) {
    assert.equal(line.prompt_id, "pr-pc", `${line.by}의 ${line.event} 줄`);
  }
});

test("PC1: hook 입력에 prompt_id가 없으면 null로 남긴다", () => {
  const projectDir = makeProjectDir();
  mkdirSync(join(projectDir, ".your-call", "ledger"), { recursive: true });

  for (const [hook, input] of Object.entries(inputsFor(projectDir, {}))) {
    runHook(hook, { stdin: JSON.stringify(input), projectDir });
  }

  const lines = readLedger(projectDir, "s-pc");
  assert.equal(lines.length >= 10, true, `${lines.length}줄`);
  for (const line of lines) {
    assert.equal(line.prompt_id, null, `${line.by}의 ${line.event} 줄`);
  }
});

test("PC1: 줄이 직접 prompt_id를 넣으면 그 값이 hook 입력의 값보다 우선한다", () => {
  const projectDir = makeProjectDir();
  const ownPromptId = fileURLToPath(new URL("./fixtures/own-prompt-id.js", import.meta.url));

  const run = spawnSync(process.execPath, [ownPromptId], {
    input: JSON.stringify({ session_id: "s-own", prompt_id: "from-input" }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(readLedger(projectDir, "s-own")[0].prompt_id, "from-line");
});
