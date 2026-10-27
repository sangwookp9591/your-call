import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, readLedger, runHook } from "./helpers.js";

// 실제 transcript에서 본 Agent 호출({description, subagent_type, model, prompt})을 따른 표본.
const brief = "Read-only cleanup review (do NOT edit anything).\n\n변경된 파일에서 이미 있는 유틸을 다시 만든 곳을 찾아라.";
/** @param {Record<string, unknown>} toolInput @param {Record<string, unknown>} [overrides] */
const delegated = (toolInput, overrides = {}) =>
  JSON.stringify({
    session_id: "s-g",
    hook_event_name: "PostToolUse",
    tool_name: "Agent",
    tool_use_id: "toolu_g",
    tool_input: toolInput,
    tool_response: { status: "completed" },
    ...overrides,
  });

/** @param {string} stdin */
function agentsFor(stdin) {
  const projectDir = makeProjectDir();
  const run = runHook("agent-capture", { stdin, projectDir });
  assert.equal(run.status, 0, run.stderr);
  if (!existsSync(join(projectDir, ".your-call", "ledger", "s-g.jsonl"))) return [];
  return readLedger(projectDir, "s-g").filter((line) => line.event === "agent");
}

test("G1: AI가 Agent 도구로 위임하면 설명, 종류, 모델, 위임 원문 전체를 agent 한 줄로 남긴다", () => {
  const [recorded] = agentsFor(delegated({ description: "Simplify review: reuse", subagent_type: "Explore", model: "haiku", prompt: brief }));
  const { v, ts, session_id, ...line } = recorded;
  assert.deepEqual(line, {
    prompt_id: null,
    event: "agent",
    by: "agent-capture",
    description: "Simplify review: reuse",
    subagent_type: "Explore",
    model: "haiku",
    prompt: brief,
    tool_use_id: "toolu_g",
  });

  const [defaults] = agentsFor(delegated({ description: "기본 에이전트", prompt: "조사해 줘" }));
  assert.equal(defaults.subagent_type, null);
  assert.equal(defaults.model, null);
});

test("G2: 다른 도구나 다른 모양의 입력은 기록하지 않고 작업을 막지 않는다", () => {
  const ignored = [
    delegated({ description: "위임", prompt: brief }, { tool_name: "Skill" }),
    delegated({ description: "원문 없음" }),
    delegated({}, { tool_input: "문자열 입력" }),
  ];
  for (const stdin of ignored) {
    assert.deepEqual(agentsFor(stdin), [], stdin.slice(0, 120));
  }

  // 같은 실행 틀에서 올바른 입력은 기록된다: 위의 빈 결과가 hook이 돌지 않아서가 아님을 보인다.
  assert.equal(agentsFor(delegated({ description: "위임", prompt: brief })).length, 1);
});

test("G2: stdout에 쓰지 않고, 기록을 쓸 수 없으면 작업을 막지 않는 오류(exit 1)로 알린다", () => {
  const stdin = delegated({ description: "위임", prompt: brief });
  const projectDir = makeProjectDir();
  const quiet = runHook("agent-capture", { stdin, projectDir });
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(readLedger(projectDir, "s-g").length, 1);
  assert.equal(quiet.stdout, "");

  const readonly = makeProjectDir();
  const ledgerDir = join(readonly, ".your-call", "ledger");
  mkdirSync(ledgerDir, { recursive: true });
  chmodSync(ledgerDir, 0o500);
  try {
    const run = runHook("agent-capture", { stdin, projectDir: readonly });

    assert.equal(run.status, 1);
    assert.match(run.stderr, /EACCES/);
  } finally {
    chmodSync(ledgerDir, 0o700);
  }
});

test("G2: 한 번 실행하는 데 Node 기동을 포함해 200ms를 넘지 않는다 (5회 중앙값)", () => {
  const projectDir = makeProjectDir();
  const durations = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    const run = runHook("agent-capture", { stdin: delegated({ description: `위임 ${i}`, prompt: brief }), projectDir });
    durations.push(performance.now() - started);
    assert.equal(run.status, 0, run.stderr);
  }

  assert.equal(readLedger(projectDir, "s-g").length, 5);
  const median = durations.sort((a, b) => a - b)[2];
  assert.ok(median < 200, `중앙값 ${median.toFixed(0)}ms`);
});
