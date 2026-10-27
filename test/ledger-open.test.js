import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { makeProjectDir, readLedger, runHook } from "./helpers.js";

/**
 * @param {string} sessionId
 * @param {string} source
 */
const sessionStart = (sessionId, source) =>
  JSON.stringify({ session_id: sessionId, hook_event_name: "SessionStart", source, cwd: "/somewhere/else" });

test("L1: 세션이 처음 시작되면 세션 기록 파일을 만들고 session-open 한 줄을 남긴다", () => {
  const projectDir = makeProjectDir();

  const run = runHook("ledger-open", { stdin: sessionStart("s-first", "startup"), projectDir });

  assert.equal(run.status, 0, run.stderr);
  const [opened, ...rest] = readLedger(projectDir, "s-first");
  assert.deepEqual(rest, []);
  assert.equal(opened.v, 1);
  assert.equal(opened.event, "session-open");
  assert.equal(opened.by, "ledger-open");
  assert.equal(opened.session_id, "s-first");
  assert.equal(opened.source, "startup");
  assert.ok(!Number.isNaN(Date.parse(opened.ts)), `ts가 시각이 아님: ${opened.ts}`);
});

test("L2: 같은 세션이 다시 시작되면 새 파일 없이 같은 파일에 덧붙이고 시작 이유를 남긴다", () => {
  const projectDir = makeProjectDir();

  runHook("ledger-open", { stdin: sessionStart("s-resumed", "startup"), projectDir });
  runHook("ledger-open", { stdin: sessionStart("s-resumed", "resume"), projectDir });

  assert.deepEqual(readdirSync(join(projectDir, ".your-call", "ledger")), ["s-resumed.jsonl"]);
  assert.deepEqual(readLedger(projectDir, "s-resumed").map((line) => line.source), ["startup", "resume"]);
});

test("L3: 입력이 잘못되었거나 session_id가 없으면 아무것도 만들지 않고 작업을 막지 않는다", () => {
  for (const stdin of ["{not json", JSON.stringify({ hook_event_name: "SessionStart", source: "startup" })]) {
    const projectDir = makeProjectDir();

    const run = runHook("ledger-open", { stdin, projectDir });

    assert.equal(run.status, 0, run.stderr);
    assert.equal(existsSync(join(projectDir, ".your-call")), false);
  }
});

test("L4: 대화에 들어가지 않도록 stdout에 아무것도 쓰지 않는다", () => {
  const projectDir = makeProjectDir();

  const run = runHook("ledger-open", { stdin: sessionStart("s-quiet", "startup"), projectDir });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(readLedger(projectDir, "s-quiet").length, 1);
  assert.equal(run.stdout, "");
});

test("L5: 프로젝트 폴더를 알 수 없으면 엉뚱한 곳에 쓰지 않고 작업을 막지 않는다", () => {
  const cwd = makeProjectDir();

  const run = runHook("ledger-open", { stdin: sessionStart("s-nowhere", "startup"), cwd });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(existsSync(join(cwd, ".your-call")), false);
});

test("L6: session_id가 경로를 벗어나려 하면 기록하지 않는다", () => {
  for (const sessionId of ["../escaped", "nested/inside", ".."]) {
    const projectDir = makeProjectDir();

    const run = runHook("ledger-open", { stdin: sessionStart(sessionId, "startup"), projectDir });

    assert.equal(run.status, 0, run.stderr);
    assert.equal(existsSync(join(projectDir, ".your-call")), false);
    assert.equal(existsSync(join(dirname(projectDir), "escaped.jsonl")), false);
  }
});

test("L7: .gitignore가 없으면 기록이 커밋되지 않게 넣고, 이미 있으면 건드리지 않는다", () => {
  const fresh = makeProjectDir();
  runHook("ledger-open", { stdin: sessionStart("s-fresh", "startup"), projectDir: fresh });
  assert.equal(readFileSync(join(fresh, ".your-call", ".gitignore"), "utf8"), "ledger/\n");

  const folderOnly = makeProjectDir();
  mkdirSync(join(folderOnly, ".your-call", "spec"), { recursive: true });
  runHook("ledger-open", { stdin: sessionStart("s-folder-only", "startup"), projectDir: folderOnly });
  assert.equal(readFileSync(join(folderOnly, ".your-call", ".gitignore"), "utf8"), "ledger/\n");

  const customized = makeProjectDir();
  mkdirSync(join(customized, ".your-call"));
  writeFileSync(join(customized, ".your-call", ".gitignore"), "# 팀이 정한 규칙\n");
  runHook("ledger-open", { stdin: sessionStart("s-custom", "startup"), projectDir: customized });
  assert.equal(readFileSync(join(customized, ".your-call", ".gitignore"), "utf8"), "# 팀이 정한 규칙\n");
});

test("L10: 기록을 쓸 수 없으면 작업을 막지 않는 오류(exit 1)로 알린다", () => {
  const projectDir = makeProjectDir();
  const ledgerDir = join(projectDir, ".your-call", "ledger");
  mkdirSync(ledgerDir, { recursive: true });
  chmodSync(ledgerDir, 0o500);
  try {
    const run = runHook("ledger-open", { stdin: sessionStart("s-readonly", "startup"), projectDir });

    assert.equal(run.status, 1);
    assert.match(run.stderr, /EACCES/);
  } finally {
    chmodSync(ledgerDir, 0o700);
  }
});

test("L8: 한 번 실행하는 데 Node 기동을 포함해 200ms를 넘지 않는다 (5회 중앙값)", () => {
  const projectDir = makeProjectDir();
  const durations = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    const run = runHook("ledger-open", { stdin: sessionStart("s-timed", "startup"), projectDir });
    durations.push(performance.now() - started);
    assert.equal(run.status, 0, run.stderr);
  }

  assert.equal(readLedger(projectDir, "s-timed").length, 5);
  const median = durations.sort((a, b) => a - b)[2];
  assert.ok(median < 200, `중앙값 ${median.toFixed(0)}ms`);
});
