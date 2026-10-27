import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, readLedger, runHook } from "./helpers.js";

// 실제 transcript(~/.claude/projects/*/*.jsonl)에서 본 모양을 따른 표본.
/** @param {string} text @param {string} timestamp */
const userTyped = (text, timestamp) =>
  JSON.stringify({ type: "user", message: { role: "user", content: text }, uuid: `u-${timestamp}`, timestamp });
/** @param {string} timestamp */
const assistantSaid = (timestamp) =>
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "작업 중…" }] }, timestamp });
/** @param {string} text @param {string} timestamp @param {string} [interruptedMessageId] */
const interruptedBy = (text, timestamp, interruptedMessageId) =>
  JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
    uuid: `i-${timestamp}`,
    timestamp,
    ...(interruptedMessageId ? { interruptedMessageId } : {}),
  });
const RESPONSE = "[Request interrupted by user]";
const TOOL_USE = "[Request interrupted by user for tool use]";

/** @param {string[]} lines */
function makeTranscript(lines) {
  const path = join(makeProjectDir(), "transcript.jsonl");
  writeFileSync(path, lines.map((line) => `${line}\n`).join(""));
  return path;
}

/** @param {string} projectDir @param {string} transcriptPath @param {string} [sessionId] */
function submitPrompt(projectDir, transcriptPath, sessionId = "s-x") {
  const stdin = JSON.stringify({ session_id: sessionId, hook_event_name: "UserPromptSubmit", prompt: "다음 입력", transcript_path: transcriptPath });
  return runHook("interrupt-capture", { stdin, projectDir });
}

/** @param {string} projectDir @param {string} [sessionId] */
function interruptsIn(projectDir, sessionId = "s-x") {
  if (!existsSync(join(projectDir, ".your-call", "ledger", `${sessionId}.jsonl`))) return [];
  return readLedger(projectDir, sessionId).filter((line) => line.event === "interrupt");
}

test("X1: 새로 생긴 중단 표시마다 종류, 시각, 끊긴 메시지를 담은 interrupt 한 줄을 ⚑개입으로 남긴다", () => {
  const projectDir = makeProjectDir();
  const transcript = makeTranscript([
    userTyped("쿠폰 만료 로직 고쳐줘", "2026-10-27T10:00:00.000Z"),
    assistantSaid("2026-10-27T10:00:01.000Z"),
    interruptedBy(RESPONSE, "2026-10-27T10:00:05.000Z", "msg_cut"),
    interruptedBy(TOOL_USE, "2026-10-27T10:01:00.000Z"),
  ]);

  const run = submitPrompt(projectDir, transcript);

  assert.equal(run.status, 0, run.stderr);
  const interrupts = interruptsIn(projectDir);
  assert.deepEqual(
    interrupts.map(({ by, kind, at, interrupted_message_id, intervention }) => ({ by, kind, at, interrupted_message_id, intervention })),
    [
      { by: "interrupt-capture", kind: "response", at: "2026-10-27T10:00:05.000Z", interrupted_message_id: "msg_cut", intervention: true },
      { by: "interrupt-capture", kind: "tool-use", at: "2026-10-27T10:01:00.000Z", interrupted_message_id: null, intervention: true },
    ],
  );
});

test("X2: 같은 중단은 입력이 여러 번 와도 한 번만 기록하고, 그 뒤에 생긴 중단은 새로 기록한다", () => {
  const projectDir = makeProjectDir();
  const transcript = makeTranscript([interruptedBy(RESPONSE, "2026-10-27T10:00:05.000Z")]);

  submitPrompt(projectDir, transcript);
  submitPrompt(projectDir, transcript);
  assert.equal(interruptsIn(projectDir).length, 1);

  appendFileSync(transcript, `${userTyped("다시 해 줘", "2026-10-27T10:02:00.000Z")}\n${interruptedBy(RESPONSE, "2026-10-27T10:03:00.000Z")}\n`);
  submitPrompt(projectDir, transcript);
  assert.deepEqual(interruptsIn(projectDir).map((line) => line.at), ["2026-10-27T10:00:05.000Z", "2026-10-27T10:03:00.000Z"]);
});

test("X3: transcript가 마지막으로 읽은 위치보다 작아지면 처음부터 다시 읽되 이미 기록한 중단은 건너뛴다", () => {
  const projectDir = makeProjectDir();
  const transcript = makeTranscript([
    userTyped("긴 대화".padEnd(5_000, "…"), "2026-10-27T09:00:00.000Z"),
    interruptedBy(RESPONSE, "2026-10-27T10:00:05.000Z"),
  ]);
  submitPrompt(projectDir, transcript);

  writeFileSync(
    transcript,
    [interruptedBy(RESPONSE, "2026-10-27T10:00:05.000Z"), interruptedBy(TOOL_USE, "2026-10-27T11:00:00.000Z")].map((l) => `${l}\n`).join(""),
  );
  submitPrompt(projectDir, transcript);

  assert.deepEqual(interruptsIn(projectDir).map((line) => line.at), ["2026-10-27T10:00:05.000Z", "2026-10-27T11:00:00.000Z"]);
});

test("X4: transcript가 없거나 깨진 줄이 있으면 그 부분만 건너뛰고 작업을 막지 않는다", () => {
  const missing = makeProjectDir();
  const noFile = submitPrompt(missing, join(missing, "없는-transcript.jsonl"));
  assert.equal(noFile.status, 0, noFile.stderr);
  assert.deepEqual(interruptsIn(missing), []);

  const noPath = makeProjectDir();
  const withoutPath = runHook("interrupt-capture", { stdin: JSON.stringify({ session_id: "s-x", prompt: "경로 없음" }), projectDir: noPath });
  assert.equal(withoutPath.status, 0, withoutPath.stderr);
  assert.equal(existsSync(join(noPath, ".your-call")), false);

  const broken = makeProjectDir();
  const transcript = makeTranscript(['{"type":"user","message":', "아예 JSON이 아님", interruptedBy(RESPONSE, "2026-10-27T10:00:05.000Z")]);
  const run = submitPrompt(broken, transcript);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(interruptsIn(broken).length, 1);
});

test("X8: 마지막 줄이 아직 다 쓰이지 않았으면 이번에는 건너뛰고, 다 쓰인 뒤 다음 입력 때 한 번 기록한다", () => {
  const projectDir = makeProjectDir();
  const transcript = makeTranscript([userTyped("쿠폰 만료 로직 고쳐줘", "2026-10-27T10:00:00.000Z")]);
  appendFileSync(transcript, interruptedBy(RESPONSE, "2026-10-27T10:00:05.000Z"));

  const whileWriting = submitPrompt(projectDir, transcript);
  assert.equal(whileWriting.status, 0, whileWriting.stderr);
  assert.deepEqual(interruptsIn(projectDir), []);

  appendFileSync(transcript, "\n");
  submitPrompt(projectDir, transcript);
  submitPrompt(projectDir, transcript);
  assert.deepEqual(interruptsIn(projectDir).map((line) => line.at), ["2026-10-27T10:00:05.000Z"]);
});

test("X5: 사람이 입력한 일반 문장은 중단으로 보지 않고, 표시 문구와 정확히 같은 줄만 인정한다", () => {
  const projectDir = makeProjectDir();
  const transcript = makeTranscript([
    userTyped(`왜 ${RESPONSE} 가 떴지?`, "2026-10-27T10:00:00.000Z"),
    interruptedBy(`${RESPONSE} 이후 다시`, "2026-10-27T10:00:01.000Z"),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: RESPONSE }] }, timestamp: "2026-10-27T10:00:02.000Z" }),
    interruptedBy(RESPONSE, "2026-10-27T10:00:03.000Z"),
  ]);

  const run = submitPrompt(projectDir, transcript);

  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(interruptsIn(projectDir).map((line) => line.at), ["2026-10-27T10:00:03.000Z"]);
});

test("X6: stdout에 쓰지 않고, 기록을 쓸 수 없으면 작업을 막지 않는 오류(exit 1)로 알린다", () => {
  const projectDir = makeProjectDir();
  const transcript = makeTranscript([interruptedBy(RESPONSE, "2026-10-27T10:00:05.000Z")]);
  const quiet = submitPrompt(projectDir, transcript);
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(interruptsIn(projectDir).length, 1);
  assert.equal(quiet.stdout, "");

  const readonly = makeProjectDir();
  const ledgerDir = join(readonly, ".your-call", "ledger");
  mkdirSync(ledgerDir, { recursive: true });
  chmodSync(ledgerDir, 0o500);
  try {
    const run = submitPrompt(readonly, transcript);

    assert.equal(run.status, 1);
    assert.match(run.stderr, /EACCES/);
  } finally {
    chmodSync(ledgerDir, 0o700);
  }
});

test("X6: 10MB transcript를 처음 읽어도 Node 기동을 포함해 200ms를 넘지 않는다 (5회 중앙값)", () => {
  const filler = Array.from({ length: 10_000 }, (_, i) => userTyped(`${i}`.padEnd(1_000, "x"), "2026-10-27T09:00:00.000Z"));
  const transcript = makeTranscript([...filler, interruptedBy(RESPONSE, "2026-10-27T10:00:05.000Z")]);
  const durations = [];
  for (let i = 0; i < 5; i++) {
    const projectDir = makeProjectDir();
    const started = performance.now();
    const run = submitPrompt(projectDir, transcript);
    durations.push(performance.now() - started);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(interruptsIn(projectDir).length, 1);
  }

  const median = durations.sort((a, b) => a - b)[2];
  assert.ok(median < 200, `중앙값 ${median.toFixed(0)}ms`);
});
