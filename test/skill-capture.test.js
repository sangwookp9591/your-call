import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, readLedger, runHook } from "./helpers.js";

// 이 세션 transcript에서 본 Skill 호출({skill, args})과 Context7의 UserPromptExpansion 타입을 따른 표본.
/** @param {Record<string, unknown>} toolInput @param {Record<string, unknown>} [overrides] */
const aiLoadedSkill = (toolInput, overrides = {}) =>
  JSON.stringify({
    session_id: "s-k",
    hook_event_name: "PostToolUse",
    tool_name: "Skill",
    tool_use_id: "toolu_k",
    tool_input: toolInput,
    tool_response: { success: true, commandName: toolInput.skill },
    ...overrides,
  });
/** @param {Record<string, unknown>} fields */
const humanTypedCommand = (fields) =>
  JSON.stringify({ session_id: "s-k", hook_event_name: "UserPromptExpansion", prompt: "확장된 본문", ...fields });

/** @param {string} stdin */
function skillsFor(stdin) {
  const projectDir = makeProjectDir();
  const run = runHook("skill-capture", { stdin, projectDir });
  assert.equal(run.status, 0, run.stderr);
  if (!existsSync(join(projectDir, ".your-call", "ledger", "s-k.jsonl"))) return [];
  return readLedger(projectDir, "s-k").filter((line) => line.event === "skill");
}

test("K1: AI가 Skill 도구로 스킬을 부르면 이름, 인자, 부른 쪽(ai)을 skill 한 줄로 남긴다", () => {
  const [withArgs] = skillsFor(aiLoadedSkill({ skill: "code-review", args: "high 123" }));
  const { v, ts, session_id, ...line } = withArgs;
  assert.deepEqual(line, {
    prompt_id: null,
    event: "skill",
    by: "skill-capture",
    name: "code-review",
    args: "high 123",
    invoked_by: "ai",
    tool_use_id: "toolu_k",
  });

  const [withoutArgs] = skillsFor(aiLoadedSkill({ skill: "artifact-diagramming" }));
  assert.equal(withoutArgs.args, null);
});

test("K2: 사람이 /명령으로 부르면 이름, 인자 원문, 출처, 확장 종류, 부른 쪽(human)을 skill 한 줄로 남긴다", () => {
  const [typed] = skillsFor(
    humanTypedCommand({
      expansion_type: "slash_command",
      command_name: "review-kit:checklist",
      command_args: " 로 이 PR 한번 점검해줘 .",
      command_source: "plugin",
    }),
  );

  const { v, ts, session_id, ...line } = typed;
  assert.deepEqual(line, {
    prompt_id: null,
    event: "skill",
    by: "skill-capture",
    name: "review-kit:checklist",
    args: " 로 이 PR 한번 점검해줘 .",
    command_source: "plugin",
    expansion_type: "slash_command",
    invoked_by: "human",
  });
});

test("K3: 다른 도구나 다른 모양의 입력은 기록하지 않고 작업을 막지 않는다", () => {
  const ignored = [
    aiLoadedSkill({ skill: "code-review" }, { tool_name: "Bash" }),
    aiLoadedSkill({ skill: 42 }),
    aiLoadedSkill({}, { tool_input: "문자열 입력" }),
    humanTypedCommand({ expansion_type: "slash_command" }),
  ];
  for (const stdin of ignored) {
    assert.deepEqual(skillsFor(stdin), [], stdin.slice(0, 120));
  }

  // 같은 실행 틀에서 올바른 입력은 기록된다: 위의 빈 결과가 hook이 돌지 않아서가 아님을 보인다.
  assert.equal(skillsFor(aiLoadedSkill({ skill: "code-review" })).length, 1);
});

test("K3: stdout에 쓰지 않고, 기록을 쓸 수 없으면 작업을 막지 않는 오류(exit 1)로 알린다", () => {
  const stdin = aiLoadedSkill({ skill: "code-review" });
  const projectDir = makeProjectDir();
  const quiet = runHook("skill-capture", { stdin, projectDir });
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(readLedger(projectDir, "s-k").length, 1);
  assert.equal(quiet.stdout, "");

  const readonly = makeProjectDir();
  const ledgerDir = join(readonly, ".your-call", "ledger");
  mkdirSync(ledgerDir, { recursive: true });
  chmodSync(ledgerDir, 0o500);
  try {
    const run = runHook("skill-capture", { stdin, projectDir: readonly });

    assert.equal(run.status, 1);
    assert.match(run.stderr, /EACCES/);
  } finally {
    chmodSync(ledgerDir, 0o700);
  }
});

test("K3: 한 번 실행하는 데 Node 기동을 포함해 200ms를 넘지 않는다 (5회 중앙값)", () => {
  const projectDir = makeProjectDir();
  const durations = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    const run = runHook("skill-capture", { stdin: aiLoadedSkill({ skill: `skill-${i}` }), projectDir });
    durations.push(performance.now() - started);
    assert.equal(run.status, 0, run.stderr);
  }

  assert.equal(readLedger(projectDir, "s-k").length, 5);
  const median = durations.sort((a, b) => a - b)[2];
  assert.ok(median < 200, `중앙값 ${median.toFixed(0)}ms`);
});
