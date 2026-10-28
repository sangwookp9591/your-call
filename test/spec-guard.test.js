import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, readLedger, runHook } from "./helpers.js";

/** 작업 폴더가 이미 있는 프로젝트. 심볼릭 링크와 대소문자 비교가 실제 폴더를 기준으로 하게 한다. */
function projectWithSpec() {
  const projectDir = makeProjectDir();
  mkdirSync(join(projectDir, ".your-call", "spec", "coupon-expiry"), { recursive: true });
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
  const stdin = JSON.stringify({ session_id: "s-sg", prompt_id: "p-sg", hook_event_name: "PreToolUse", tool_name: tool, tool_use_id: "toolu_sg", tool_input: toolInput, cwd });
  return runHook("spec-guard", { stdin, projectDir });
}

/** @param {ReturnType<typeof tryWrite>} run */
const blocked = (run) => run.status === 2;
const CASES = ".your-call/spec/coupon-expiry/cases.md";

test("SG1: AI가 Write, Edit, NotebookEdit로 .your-call/spec/<작업>/cases.md를 쓰려 하면 exit 2로 막고, 이유와 대신 할 수 있는 일을 남긴다", () => {
  const projectDir = projectWithSpec();
  const attempts = [
    ["Write", { file_path: join(projectDir, CASES), content: "- C1: AI가 정한 기준" }],
    ["Edit", { file_path: join(projectDir, CASES), old_string: "- C1: 가", new_string: "- C1: 나" }],
    ["NotebookEdit", { notebook_path: join(projectDir, CASES), new_source: "" }],
    // 작업 이름 규칙 밖 폴더의 cases.md도 막는다 (확정한 결정).
    ["Write", { file_path: join(projectDir, ".your-call", "spec", "쿠폰 만료", "cases.md"), content: "- C1: 가" }],
  ];
  for (const [tool, toolInput] of attempts) {
    const run = tryWrite(projectDir, String(tool), /** @type {Record<string, unknown>} */ (toolInput));

    assert.equal(run.status, 2, `${tool}: ${run.stderr}`);
    assert.match(run.stderr, /사람이 확정한 케이스/);
    assert.match(run.stderr, /proposals\.md/);
    assert.equal(run.stdout, "");
  }

  // 막은 사실을 기록하지 못해도 막는 것은 그대로다.
  const readonly = projectWithSpec();
  chmodSync(join(readonly, ".your-call", "ledger"), 0o500);
  try {
    assert.ok(blocked(tryWrite(readonly, "Write", { file_path: CASES })));
  } finally {
    chmodSync(join(readonly, ".your-call", "ledger"), 0o700);
  }
});

test("SG2: 상대 경로, .., 실제 경로 차이, 심볼릭 링크, 대소문자 차이로 돌아 들어와도 막는다", () => {
  const projectDir = projectWithSpec();
  const realProject = realpathSync(projectDir);
  symlinkSync(join(projectDir, ".your-call", "spec", "coupon-expiry"), join(projectDir, "agreed"));
  const detours = [
    ["AI가 src에 있을 때의 상대 경로", `../${CASES}`, join(projectDir, "src")],
    ["중간에 .. 섞기", `src/../${CASES}`, projectDir],
    ["프로젝트 폴더의 실제 경로로 쓰기 (/var → /private/var)", join(realProject, CASES), projectDir],
    ["심볼릭 링크를 거쳐 쓰기", "agreed/cases.md", projectDir],
    ["대소문자 바꾸기", ".Your-Call/Spec/coupon-expiry/CASES.md", projectDir],
  ];
  for (const [how, filePath, cwd] of detours) {
    assert.ok(blocked(tryWrite(projectDir, "Write", { file_path: filePath }, cwd)), how);
  }
});

test("SG3: 그 밖의 곳은 조용히 통과시킨다 (proposals.md, spec 바로 아래, 하위 폴더, 이름만 비슷한 것, 다른 cases.md)", () => {
  const projectDir = projectWithSpec();
  const outside = [
    ".your-call/spec/coupon-expiry/proposals.md",
    ".your-call/spec/cases.md",
    ".your-call/spec/coupon-expiry/notes/cases.md",
    ".your-call/spec/coupon-expiry/cases.md.bak",
    ".your-call/spec/coupon-expiry/my-cases.md",
    "docs/cases.md",
    "src/coupon.ts",
  ];
  for (const filePath of outside) {
    const run = tryWrite(projectDir, "Write", { file_path: filePath });

    assert.equal(run.status, 0, `${filePath}: ${run.stderr}`);
    assert.equal(run.stdout, "");
    assert.equal(run.stderr, "");
  }

  // 같은 실행 틀에서 cases.md는 막힌다: 위의 통과가 hook이 돌지 않아서가 아님을 보인다.
  assert.ok(blocked(tryWrite(projectDir, "Write", { file_path: CASES })));
});

test("SG4: 판단 재료(입력, 프로젝트 폴더, 경로)가 없으면 통과시킨다", () => {
  const projectDir = projectWithSpec();
  const casesFile = join(projectDir, CASES);

  assert.equal(runHook("spec-guard", { stdin: "{깨진 입력", projectDir }).status, 0);
  assert.equal(tryWrite(undefined, "Write", { file_path: casesFile }, projectDir).status, 0);
  assert.equal(tryWrite(projectDir, "Write", { content: "경로 없음" }).status, 0);
  assert.equal(tryWrite(projectDir, "Write", { file_path: 42 }).status, 0);

  // 같은 실행 틀에서 재료가 있으면 막힌다: 위의 통과가 hook이 돌지 않아서가 아님을 보인다.
  assert.ok(blocked(tryWrite(projectDir, "Write", { file_path: casesFile })));
});

test("SG5: 막을 때 어떤 도구로 어느 경로를 쓰려 했는지 blocked 한 줄을 남긴다 (by spec-guard, prompt_id 포함)", () => {
  const projectDir = projectWithSpec();

  tryWrite(projectDir, "Edit", { file_path: CASES, old_string: "- C1: 가", new_string: "- C1: AI가 고친 기준" });

  const [line] = readLedger(projectDir, "s-sg").filter((entry) => entry.event === "blocked");
  assert.equal(line.by, "spec-guard");
  assert.equal(line.tool, "Edit");
  assert.equal(line.file_path, CASES);
  assert.equal(line.prompt_id, "p-sg");
});

test("SG6: 한 번 판단하는 데 Node 기동을 포함해 200ms를 넘지 않는다 (5회 중앙값)", () => {
  const projectDir = projectWithSpec();
  const durations = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    const run = tryWrite(projectDir, "Write", { file_path: i % 2 ? "src/a.ts" : CASES });
    durations.push(performance.now() - started);
    assert.equal(run.status, i % 2 ? 0 : 2, run.stderr);
  }

  assert.equal(existsSync(join(projectDir, ".your-call", "ledger", "s-sg.jsonl")), true);
  const median = durations.sort((a, b) => a - b)[2];
  assert.ok(median < 200, `중앙값 ${median.toFixed(0)}ms`);
});
