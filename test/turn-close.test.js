import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, readLedger, runHook } from "./helpers.js";

// Context7의 StopHookInput 타입을 따른 표본.
/** @param {Record<string, unknown>} fields */
const stopped = (fields) =>
  JSON.stringify({ session_id: "s-t", hook_event_name: "Stop", stop_hook_active: false, ...fields });

/** @param {string} stdin */
function turnClosesFor(stdin) {
  const projectDir = makeProjectDir();
  const run = runHook("turn-close", { stdin, projectDir });
  assert.equal(run.status, 0, run.stderr);
  if (!existsSync(join(projectDir, ".your-call", "ledger", "s-t.jsonl"))) return [];
  return readLedger(projectDir, "s-t").filter((line) => line.event === "turn-close");
}

test("T1: Stop이 오면 입력 id, AI의 마지막 응답 원문, 진행 중인 백그라운드 작업 수를 turn-close 한 줄로 남긴다", () => {
  const lastMessage = "쿠폰 만료 로직을 서버 시간 기준으로 바꿨습니다.\n테스트 12개가 통과합니다.";
  const [line] = turnClosesFor(
    stopped({ prompt_id: "pr-t", last_assistant_message: lastMessage, background_tasks: [{ id: "a" }, { id: "b" }] }),
  );

  const { v, ts, session_id, ...rest } = line;
  assert.deepEqual(rest, {
    event: "turn-close",
    by: "turn-close",
    prompt_id: "pr-t",
    last_message: lastMessage,
    background_tasks: 2,
  });

  const [bare] = turnClosesFor(stopped({}));
  assert.equal(bare.prompt_id, null);
  assert.equal(bare.last_message, null);
  assert.equal(bare.background_tasks, null);
});

test("T2: 다른 Stop hook이 이미 돌고 있으면(stop_hook_active) 기록하지 않는다", () => {
  assert.deepEqual(turnClosesFor(stopped({ stop_hook_active: true, last_assistant_message: "중복" })), []);

  // 같은 실행 틀에서 stop_hook_active가 false면 기록된다: 위의 빈 결과가 hook이 돌지 않아서가 아님을 보인다.
  assert.equal(turnClosesFor(stopped({ last_assistant_message: "한 번" })).length, 1);
});

test("T3: 멈춤을 막지 않는다 — stdout에 쓰지 않고, 기록을 쓸 수 없어도 막는 코드(2)가 아닌 exit 1로 알린다", () => {
  const stdin = stopped({ last_assistant_message: "끝" });
  const projectDir = makeProjectDir();
  const quiet = runHook("turn-close", { stdin, projectDir });
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(readLedger(projectDir, "s-t").length, 1);
  assert.equal(quiet.stdout, "");

  const readonly = makeProjectDir();
  const ledgerDir = join(readonly, ".your-call", "ledger");
  mkdirSync(ledgerDir, { recursive: true });
  chmodSync(ledgerDir, 0o500);
  try {
    const run = runHook("turn-close", { stdin, projectDir: readonly });

    assert.equal(run.status, 1);
    assert.match(run.stderr, /EACCES/);
  } finally {
    chmodSync(ledgerDir, 0o700);
  }
});

test("T3: 한 번 실행하는 데 Node 기동을 포함해 200ms를 넘지 않는다 (5회 중앙값)", () => {
  const projectDir = makeProjectDir();
  const durations = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    const run = runHook("turn-close", { stdin: stopped({ last_assistant_message: `${i}번째 응답` }), projectDir });
    durations.push(performance.now() - started);
    assert.equal(run.status, 0, run.stderr);
  }

  assert.equal(readLedger(projectDir, "s-t").length, 5);
  const median = durations.sort((a, b) => a - b)[2];
  assert.ok(median < 200, `중앙값 ${median.toFixed(0)}ms`);
});
