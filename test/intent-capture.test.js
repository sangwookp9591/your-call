import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, readLedger, runHook } from "./helpers.js";

/**
 * @param {string} sessionId
 * @param {Record<string, unknown>} fields
 */
const promptSubmit = (sessionId, fields) =>
  JSON.stringify({ session_id: sessionId, hook_event_name: "UserPromptSubmit", ...fields });

/**
 * 입력 하나를 보내고 남은 intent 줄의 text들을 돌려준다. 기록 파일이 없으면 빈 배열.
 * @param {string} prompt
 * @param {Record<string, unknown>} [fields]
 */
function intentsFor(prompt, fields = { source: "user" }) {
  const projectDir = makeProjectDir();
  const run = runHook("intent-capture", { stdin: promptSubmit("s-w", { prompt, prompt_id: "pr-w", ...fields }), projectDir });
  assert.equal(run.status, 0, run.stderr);
  if (!existsSync(join(projectDir, ".your-call", "ledger", "s-w.jsonl"))) return [];
  return readLedger(projectDir, "s-w").filter((line) => line.event === "intent").map((line) => line.text);
}

test("W1: 사람이 why:로 시작하는 입력을 보내면 의도를 intent 한 줄로 남기고 같은 입력의 prompt_id로 잇는다", () => {
  const projectDir = makeProjectDir();
  const stdin = promptSubmit("s-w1", { prompt: "why:  만료 판정을 서버 시간 기준으로 통일  ", prompt_id: "pr-1", source: "user" });

  const run = runHook("intent-capture", { stdin, projectDir });

  assert.equal(run.status, 0, run.stderr);
  const [line, ...rest] = readLedger(projectDir, "s-w1");
  assert.deepEqual(rest, []);
  assert.equal(line.event, "intent");
  assert.equal(line.by, "intent-capture");
  assert.equal(line.text, "만료 판정을 서버 시간 기준으로 통일");
  assert.equal(line.prompt_id, "pr-1");
  assert.equal(line.source, "user");
});

test("W2: 의도는 why: 줄부터 첫 빈 줄 전까지이고, 빈 줄 뒤의 지시는 들어가지 않는다", () => {
  const prompt = "why: 만료 판정을 서버 시간 기준으로 통일\n타임존 버그가 반복돼서\n\n쿠폰 만료 로직 고쳐줘";

  assert.deepEqual(intentsFor(prompt), ["만료 판정을 서버 시간 기준으로 통일\n타임존 버그가 반복돼서"]);
  assert.deepEqual(intentsFor("why: 공백만 있는 줄도 빈 줄이다\n   \n지시"), ["공백만 있는 줄도 빈 줄이다"]);
  assert.deepEqual(intentsFor("why: 빈 줄이 없으면 끝까지\n둘째 줄"), ["빈 줄이 없으면 끝까지\n둘째 줄"]);
});

test("W3: 앞 공백 뒤의 why:와 대소문자가 다른 Why:, WHY:도 인정하고, 첫머리가 아닌 why:는 무시한다", () => {
  assert.deepEqual(intentsFor("  \n  why: 앞 공백"), ["앞 공백"]);
  assert.deepEqual(intentsFor("Why: 대문자 시작"), ["대문자 시작"]);
  assert.deepEqual(intentsFor("WHY: 모두 대문자"), ["모두 대문자"]);
  assert.deepEqual(intentsFor("이거 고쳐줘. why: 문장 중간"), []);
  assert.deepEqual(intentsFor("whyever: 다른 단어"), []);
});

test("W4: why: 뒤가 비어 있으면 기록하지 않는다", () => {
  assert.deepEqual(intentsFor("why:"), []);
  assert.deepEqual(intentsFor("why:    "), []);
  assert.deepEqual(intentsFor("why:\n\n쿠폰 만료 로직 고쳐줘"), []);
});

test("W5: 사람이 넣은 입력(user, sdk, 값 없음)만 인정하고 기계가 넣은 입력은 why:가 있어도 기록하지 않는다", () => {
  assert.deepEqual(intentsFor("why: 입력창", { source: "user" }), ["입력창"]);
  assert.deepEqual(intentsFor("why: -p 실행", { source: "sdk" }), ["-p 실행"]);
  assert.deepEqual(intentsFor("why: 값 없음", {}), ["값 없음"]);
  for (const source of ["system", "loop_wakeup", "schedule_wakeup", "poll_event"]) {
    assert.deepEqual(intentsFor("why: 기계가 넣은 턴", { source }), [], source);
  }
});

test("W6: stdout에 쓰지 않고, 잘못된 입력은 기록 없이 exit 0으로 끝낸다", () => {
  const projectDir = makeProjectDir();
  const run = runHook("intent-capture", { stdin: promptSubmit("s-w6", { prompt: "why: 조용히", source: "user" }), projectDir });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readLedger(projectDir, "s-w6").length, 1);
  assert.equal(run.stdout, "");

  for (const stdin of ["{not json", JSON.stringify({ prompt: "why: 세션 없음" }), promptSubmit("s-w6", { prompt: 42 })]) {
    const empty = makeProjectDir();
    const invalid = runHook("intent-capture", { stdin, projectDir: empty });
    assert.equal(invalid.status, 0, invalid.stderr);
    assert.equal(existsSync(join(empty, ".your-call")), false, stdin);
  }
});

test("W6: 기록을 쓸 수 없으면 작업을 막지 않는 오류(exit 1)로 알린다", () => {
  const projectDir = makeProjectDir();
  const ledgerDir = join(projectDir, ".your-call", "ledger");
  mkdirSync(ledgerDir, { recursive: true });
  chmodSync(ledgerDir, 0o500);
  try {
    const run = runHook("intent-capture", { stdin: promptSubmit("s-w6-ro", { prompt: "why: 못 씀" }), projectDir });

    assert.equal(run.status, 1);
    assert.match(run.stderr, /EACCES/);
  } finally {
    chmodSync(ledgerDir, 0o700);
  }
});

test("W6: 한 번 실행하는 데 Node 기동을 포함해 200ms를 넘지 않는다 (5회 중앙값)", () => {
  const projectDir = makeProjectDir();
  const durations = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    const run = runHook("intent-capture", { stdin: promptSubmit("s-w6-t", { prompt: `why: ${i}번째` }), projectDir });
    durations.push(performance.now() - started);
    assert.equal(run.status, 0, run.stderr);
  }

  assert.equal(readLedger(projectDir, "s-w6-t").length, 5);
  const median = durations.sort((a, b) => a - b)[2];
  assert.ok(median < 200, `중앙값 ${median.toFixed(0)}ms`);
});
