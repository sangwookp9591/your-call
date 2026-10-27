import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, readLedger, runHook, startHook } from "./helpers.js";

/**
 * @param {string} sessionId
 * @param {Record<string, unknown>} fields
 */
const promptSubmit = (sessionId, fields) =>
  JSON.stringify({ session_id: sessionId, hook_event_name: "UserPromptSubmit", ...fields });

test("P1: 입력이 들어오면 원문과 prompt_id, 누가 넣었는지를 prompt 한 줄로 남긴다", () => {
  const projectDir = makeProjectDir();
  const stdin = promptSubmit("s-p1", { prompt: "쿠폰 만료 로직 고쳐줘", prompt_id: "pr-1", source: "user" });

  const run = runHook("prompt-capture", { stdin, projectDir });

  assert.equal(run.status, 0, run.stderr);
  const [line, ...rest] = readLedger(projectDir, "s-p1");
  assert.deepEqual(rest, []);
  assert.equal(line.event, "prompt");
  assert.equal(line.by, "prompt-capture");
  assert.equal(line.text, "쿠폰 만료 로직 고쳐줘");
  assert.equal(line.prompt_id, "pr-1");
  assert.equal(line.source, "user");
});

test("P1: 누가 넣었는지 알 수 없으면 source를 null로 남긴다", () => {
  const projectDir = makeProjectDir();

  runHook("prompt-capture", { stdin: promptSubmit("s-p1-nosource", { prompt: "확인", prompt_id: "pr-2" }), projectDir });

  assert.equal(readLedger(projectDir, "s-p1-nosource")[0].source, null);
});

test("P2: 앞뒤 공백, 여러 줄, 따옴표, 이모지, why: 접두어를 손대지 않고 그대로 남긴다", () => {
  const projectDir = makeProjectDir();
  const original = '  why: 만료 판정을 서버 시간 기준으로 통일\n쿠폰 "만료" 로직 고쳐줘 🙏\n\n';

  runHook("prompt-capture", { stdin: promptSubmit("s-p2", { prompt: original, prompt_id: "pr-3" }), projectDir });

  assert.equal(readLedger(projectDir, "s-p2")[0].text, original);
});

test("P3: 대화에 들어가지 않도록 stdout에 아무것도 쓰지 않는다", () => {
  const projectDir = makeProjectDir();

  const run = runHook("prompt-capture", { stdin: promptSubmit("s-p3", { prompt: "조용히", prompt_id: "pr-4" }), projectDir });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(readLedger(projectDir, "s-p3").length, 1);
  assert.equal(run.stdout, "");
});

test("P4: 입력이 잘못되었거나 session_id가 없거나 원문이 문자열이 아니면 기록하지 않고 작업을 막지 않는다", () => {
  const invalidInputs = [
    "{not json",
    JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "세션 없음" }),
    promptSubmit("s-p4", { prompt: 42 }),
    promptSubmit("s-p4", {}),
    promptSubmit("../escaped", { prompt: "경로 탈출" }),
  ];
  for (const stdin of invalidInputs) {
    const projectDir = makeProjectDir();

    const run = runHook("prompt-capture", { stdin, projectDir });

    assert.equal(run.status, 0, run.stderr);
    assert.equal(existsSync(join(projectDir, ".your-call")), false, stdin);
  }

  const run = runHook("prompt-capture", { stdin: promptSubmit("s-p4", { prompt: "프로젝트 모름" }), cwd: makeProjectDir() });
  assert.equal(run.status, 0, run.stderr);
});

test("P5: 기록을 쓸 수 없으면 작업을 막지 않는 오류(exit 1)로 알린다", () => {
  const projectDir = makeProjectDir();
  const ledgerDir = join(projectDir, ".your-call", "ledger");
  mkdirSync(ledgerDir, { recursive: true });
  chmodSync(ledgerDir, 0o500);
  try {
    const run = runHook("prompt-capture", { stdin: promptSubmit("s-p5", { prompt: "못 씀" }), projectDir });

    assert.equal(run.status, 1);
    assert.match(run.stderr, /EACCES/);
  } finally {
    chmodSync(ledgerDir, 0o700);
  }
});

test("P6: 여러 hook이 같은 기록 파일에 동시에 큰 줄을 덧붙여도 모든 줄이 온전하다", async () => {
  const projectDir = makeProjectDir();
  const writers = 6;
  const bigPrompts = Array.from({ length: writers }, (_, i) => `${i}:`.padEnd(200_000, String.fromCharCode(65 + i)));

  const exitCodes = await Promise.all(
    bigPrompts.map((prompt, i) =>
      startHook("prompt-capture", { stdin: promptSubmit("s-p6", { prompt, prompt_id: `pr-${i}` }), projectDir }),
    ),
  );

  assert.deepEqual(exitCodes, Array(writers).fill(0));
  const texts = readLedger(projectDir, "s-p6").map((line) => line.text);
  assert.deepEqual(texts.sort(), [...bigPrompts].sort());
});

test("P7: 한 번 실행하는 데 Node 기동을 포함해 200ms를 넘지 않는다 (5회 중앙값)", () => {
  const projectDir = makeProjectDir();
  const durations = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    const run = runHook("prompt-capture", { stdin: promptSubmit("s-p7", { prompt: `${i}번째 입력` }), projectDir });
    durations.push(performance.now() - started);
    assert.equal(run.status, 0, run.stderr);
  }

  assert.equal(readLedger(projectDir, "s-p7").length, 5);
  const median = durations.sort((a, b) => a - b)[2];
  assert.ok(median < 200, `중앙값 ${median.toFixed(0)}ms`);
});
