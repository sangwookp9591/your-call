import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, readLedger, runHook } from "./helpers.js";

/** 기록 폴더가 이미 있는 프로젝트. 심볼릭 링크와 대소문자 비교가 실제 폴더를 기준으로 하게 한다. */
function projectWithLedger() {
  const projectDir = makeProjectDir();
  mkdirSync(join(projectDir, ".your-call", "ledger"), { recursive: true });
  mkdirSync(join(projectDir, "src"));
  return projectDir;
}

/**
 * @param {string | undefined} projectDir
 * @param {string} tool
 * @param {Record<string, unknown>} toolInput
 * @param {string} [cwd] hook 입력의 cwd (AI가 있던 폴더)
 */
function tryWrite(projectDir, tool, toolInput, cwd = projectDir) {
  const stdin = JSON.stringify({ session_id: "s-lg", hook_event_name: "PreToolUse", tool_name: tool, tool_use_id: "toolu_lg", tool_input: toolInput, cwd });
  return runHook("ledger-guard", { stdin, projectDir });
}

/** @param {ReturnType<typeof tryWrite>} run */
const blocked = (run) => run.status === 2;

test("LG1: AI가 Write, Edit, NotebookEdit로 기록 폴더 아래를 쓰려 하면 exit 2로 막고 이유를 남긴다", () => {
  const projectDir = projectWithLedger();
  const attempts = [
    ["Write", { file_path: join(projectDir, ".your-call", "ledger", "s-lg.jsonl"), content: '{"event":"intent"}' }],
    ["Edit", { file_path: join(projectDir, ".your-call", "ledger", ".state", "s-lg.interrupt.json"), old_string: "1", new_string: "0" }],
    ["NotebookEdit", { notebook_path: join(projectDir, ".your-call", "ledger", "x.ipynb"), new_source: "" }],
  ];
  for (const [tool, toolInput] of attempts) {
    const run = tryWrite(projectDir, String(tool), /** @type {Record<string, unknown>} */ (toolInput));

    assert.equal(run.status, 2, `${tool}: ${run.stderr}`);
    assert.match(run.stderr, /hook만/);
    assert.match(run.stderr, /why:/);
    assert.equal(run.stdout, "");
  }

  // 막은 사실을 기록하지 못해도 막는 것은 그대로다.
  const readonly = projectWithLedger();
  chmodSync(join(readonly, ".your-call", "ledger"), 0o500);
  try {
    const run = tryWrite(readonly, "Write", { file_path: join(readonly, ".your-call", "ledger", "x.jsonl") });
    assert.equal(run.status, 2, run.stderr);
  } finally {
    chmodSync(join(readonly, ".your-call", "ledger"), 0o700);
  }
});

test("LG2: 상대 경로, .., 실제 경로 차이, 심볼릭 링크, 대소문자 차이로 돌아 들어와도 막는다", () => {
  const projectDir = projectWithLedger();
  const realProject = realpathSync(projectDir);
  symlinkSync(join(projectDir, ".your-call", "ledger"), join(projectDir, "notes"));
  const detours = [
    ["AI가 src에 있을 때의 상대 경로", "../.your-call/ledger/x.jsonl", join(projectDir, "src")],
    ["중간에 .. 섞기", "src/../.your-call/ledger/x.jsonl", projectDir],
    ["프로젝트 폴더의 실제 경로로 쓰기 (/var → /private/var)", join(realProject, ".your-call", "ledger", "x.jsonl"), projectDir],
    ["심볼릭 링크를 거쳐 쓰기", "notes/x.jsonl", projectDir],
    ["대소문자 바꾸기", ".Your-Call/Ledger/x.jsonl", projectDir],
  ];
  for (const [how, filePath, cwd] of detours) {
    assert.ok(blocked(tryWrite(projectDir, "Write", { file_path: filePath }, cwd)), how);
  }
});

test("LG3: 기록 폴더 밖은 조용히 통과시킨다 (이름만 비슷한 곳 포함)", () => {
  const projectDir = projectWithLedger();
  const outside = ["src/coupon.ts", ".your-call/.gitignore", ".your-call/ledger-notes.md", ".your-call-ledger/x.jsonl", "ledger/x.jsonl"];
  for (const filePath of outside) {
    const run = tryWrite(projectDir, "Write", { file_path: filePath });

    assert.equal(run.status, 0, `${filePath}: ${run.stderr}`);
    assert.equal(run.stdout, "");
    assert.equal(run.stderr, "");
  }

  // 같은 실행 틀에서 기록 폴더는 막힌다: 위의 통과가 hook이 돌지 않아서가 아님을 보인다.
  assert.ok(blocked(tryWrite(projectDir, "Write", { file_path: ".your-call/ledger/x.jsonl" })));
});

test("LG4: 판단 재료(입력, 프로젝트 폴더, 경로)가 없으면 통과시킨다", () => {
  const projectDir = projectWithLedger();
  const ledgerFile = join(projectDir, ".your-call", "ledger", "x.jsonl");

  assert.equal(runHook("ledger-guard", { stdin: "{깨진 입력", projectDir }).status, 0);
  assert.equal(tryWrite(undefined, "Write", { file_path: ledgerFile }, projectDir).status, 0);
  assert.equal(tryWrite(projectDir, "Write", { content: "경로 없음" }).status, 0);
  assert.equal(tryWrite(projectDir, "Write", { file_path: 42 }).status, 0);

  // 같은 실행 틀에서 재료가 있으면 막힌다: 위의 통과가 hook이 돌지 않아서가 아님을 보인다.
  assert.ok(blocked(tryWrite(projectDir, "Write", { file_path: ledgerFile })));
});

test("LG5: 막을 때 어떤 도구로 어느 경로를 쓰려 했는지 blocked 한 줄을 남긴다", () => {
  const projectDir = projectWithLedger();

  tryWrite(projectDir, "Edit", { file_path: ".your-call/ledger/s-lg.jsonl", old_string: "null", new_string: '"AI가 쓴 이유"' });

  const [line] = readLedger(projectDir, "s-lg").filter((entry) => entry.event === "blocked");
  assert.equal(line.by, "ledger-guard");
  assert.equal(line.tool, "Edit");
  assert.equal(line.file_path, ".your-call/ledger/s-lg.jsonl");
});

test("LG6: 한 번 판단하는 데 Node 기동을 포함해 200ms를 넘지 않는다 (5회 중앙값)", () => {
  const projectDir = projectWithLedger();
  const durations = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    const run = tryWrite(projectDir, "Write", { file_path: i % 2 ? "src/a.ts" : ".your-call/ledger/x.jsonl" });
    durations.push(performance.now() - started);
    assert.equal(run.status, i % 2 ? 0 : 2, run.stderr);
  }

  assert.equal(existsSync(join(projectDir, ".your-call", "ledger", "s-lg.jsonl")), true);
  const median = durations.sort((a, b) => a - b)[2];
  assert.ok(median < 200, `중앙값 ${median.toFixed(0)}ms`);
});
