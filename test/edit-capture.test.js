import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, readLedger, runHook } from "./helpers.js";

/** @param {string} toolName @param {Record<string, unknown>} toolInput @param {Record<string, unknown>} [overrides] */
const edited = (toolName, toolInput, overrides = {}) =>
  JSON.stringify({
    session_id: "s-d",
    hook_event_name: "PostToolUse",
    tool_name: toolName,
    tool_use_id: "toolu_d",
    tool_input: toolInput,
    tool_response: { success: true },
    ...overrides,
  });

/** @param {string} stdin */
function editsFor(stdin) {
  const projectDir = makeProjectDir();
  const run = runHook("edit-capture", { stdin, projectDir });
  assert.equal(run.status, 0, run.stderr);
  if (!existsSync(join(projectDir, ".your-call", "ledger", "s-d.jsonl"))) return [];
  return readLedger(projectDir, "s-d").filter((line) => line.event === "edit");
}

test("D1: AI가 Write, Edit, NotebookEdit로 파일을 바꾸면 도구와 파일 경로를 edit 한 줄로 남긴다", () => {
  const cases = [
    ["Write", { file_path: "/repo/src/coupon.ts", content: "export {}" }, "/repo/src/coupon.ts"],
    ["Edit", { file_path: "src/coupon.ts", old_string: "a", new_string: "b" }, "src/coupon.ts"],
    ["NotebookEdit", { notebook_path: "/repo/analysis.ipynb", new_source: "print(1)" }, "/repo/analysis.ipynb"],
  ];
  for (const [tool, input, path] of cases) {
    const [line] = editsFor(edited(String(tool), /** @type {Record<string, unknown>} */ (input)));
    assert.equal(line.by, "edit-capture");
    assert.equal(line.tool, tool);
    assert.equal(line.file_path, path);
    assert.equal(line.tool_use_id, "toolu_d");
  }
});

test("D2: 파일 내용이나 바뀐 부분은 기록하지 않는다", () => {
  const [line] = editsFor(edited("Edit", { file_path: "src/coupon.ts", old_string: "비밀 이전 코드", new_string: "비밀 새 코드" }));

  assert.deepEqual(Object.keys(line).sort(), ["by", "event", "file_path", "prompt_id", "session_id", "tool", "tool_use_id", "ts", "v"]);
  assert.equal(JSON.stringify(line).includes("비밀"), false);
});

test("D3: 다른 도구나 다른 모양의 입력은 기록하지 않고 작업을 막지 않는다", () => {
  const ignored = [
    edited("Bash", { command: "sed -i '' s/a/b/ src/coupon.ts" }),
    edited("Read", { file_path: "src/coupon.ts" }),
    edited("Edit", { file_path: 42 }),
    edited("Write", {}, { tool_input: "문자열 입력" }),
  ];
  for (const stdin of ignored) {
    assert.deepEqual(editsFor(stdin), [], stdin.slice(0, 120));
  }

  // 같은 실행 틀에서 올바른 입력은 기록된다: 위의 빈 결과가 hook이 돌지 않아서가 아님을 보인다.
  assert.equal(editsFor(edited("Edit", { file_path: "src/coupon.ts" })).length, 1);
});

test("D3: stdout에 쓰지 않고, 기록을 쓸 수 없으면 작업을 막지 않는 오류(exit 1)로 알린다", () => {
  const stdin = edited("Write", { file_path: "src/coupon.ts", content: "" });
  const projectDir = makeProjectDir();
  const quiet = runHook("edit-capture", { stdin, projectDir });
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(readLedger(projectDir, "s-d").length, 1);
  assert.equal(quiet.stdout, "");

  const readonly = makeProjectDir();
  const ledgerDir = join(readonly, ".your-call", "ledger");
  mkdirSync(ledgerDir, { recursive: true });
  chmodSync(ledgerDir, 0o500);
  try {
    const run = runHook("edit-capture", { stdin, projectDir: readonly });

    assert.equal(run.status, 1);
    assert.match(run.stderr, /EACCES/);
  } finally {
    chmodSync(ledgerDir, 0o700);
  }
});

test("D3: 한 번 실행하는 데 Node 기동을 포함해 200ms를 넘지 않는다 (5회 중앙값)", () => {
  const projectDir = makeProjectDir();
  const durations = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    const run = runHook("edit-capture", { stdin: edited("Edit", { file_path: `src/file-${i}.ts` }), projectDir });
    durations.push(performance.now() - started);
    assert.equal(run.status, 0, run.stderr);
  }

  assert.equal(readLedger(projectDir, "s-d").length, 5);
  const median = durations.sort((a, b) => a - b)[2];
  assert.ok(median < 200, `중앙값 ${median.toFixed(0)}ms`);
});
