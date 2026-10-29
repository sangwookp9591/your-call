import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, readLedger, runHook } from "./helpers.js";

/** 기록 폴더가 있는 프로젝트 (플러그인이 켜진 세션이면 SessionStart가 만든다) */
function project() {
  const projectDir = makeProjectDir();
  mkdirSync(join(projectDir, ".your-call", "ledger"), { recursive: true });
  return projectDir;
}

/**
 * @param {string | undefined} projectDir
 * @param {unknown} command
 */
function tryRun(projectDir, command) {
  const stdin = JSON.stringify({ session_id: "s-srg", prompt_id: "p-srg", hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "toolu_srg", tool_input: { command }, cwd: projectDir });
  return runHook("share-run-guard", { stdin, projectDir });
}

/** @param {ReturnType<typeof tryRun>} run */
const blocked = (run) => run.status === 2;
const INSTALLED_SHARE = "node /Users/me/.claude/plugins/cache/your-call/your-call/0.2.0/scripts/share.js 1 3";

test("SRG1: AI가 Bash로 node, share.js, 플러그인 표식(your-call 또는 CLAUDE_PLUGIN_ROOT)이 함께 든 명령을 실행하려 하면 exit 2로 막고, 공유본은 사람이 /your-call:share로 만든다고 알린다", () => {
  const run = tryRun(project(), INSTALLED_SHARE);

  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /\/your-call:share/);
  assert.match(run.stderr, /사람/);
  assert.equal(run.stdout, "");
});

test("SRG2: 흔한 변형도 막는다: cd …/your-call/…/scripts && node share.js, node \"${CLAUDE_PLUGIN_ROOT}/scripts/share.js\" 1, 대소문자 차이(Share.JS)", () => {
  const projectDir = project();
  const variants = [
    "cd /Users/me/.claude/plugins/cache/your-call/your-call/0.2.0/scripts && node share.js 1",
    'node "${CLAUDE_PLUGIN_ROOT}/scripts/share.js" 1',
    "node /Users/me/Projects/your-call/plugins/your-call/scripts/Share.JS 2",
  ];
  for (const command of variants) assert.ok(blocked(tryRun(projectDir, command)), command);
});

test("SRG3: 그 밖의 Bash는 조용히 통과시킨다: 사용자 프로젝트의 node src/share.js, your-call의 다른 스크립트(ledger-view.js), node가 없는 명령(cat …/your-call/scripts/share.js)", () => {
  const projectDir = project();
  const others = [
    "node src/share.js",
    "node /Users/me/.claude/plugins/cache/your-call/your-call/0.2.0/scripts/ledger-view.js",
    "cat /Users/me/.claude/plugins/cache/your-call/your-call/0.2.0/scripts/share.js",
  ];
  for (const command of others) {
    const run = tryRun(projectDir, command);

    assert.equal(run.status, 0, `${command}: ${run.stderr}`);
    assert.equal(run.stdout, "");
    assert.equal(run.stderr, "");
  }

  // 같은 실행 틀에서 share.js 실행은 막힌다: 위의 통과가 hook이 돌지 않아서가 아님을 보인다.
  assert.ok(blocked(tryRun(projectDir, INSTALLED_SHARE)));
});

test("SRG4: 판단 재료(입력, 프로젝트 폴더, 명령)가 없으면 통과시킨다", () => {
  const projectDir = project();

  assert.equal(runHook("share-run-guard", { stdin: "{깨진 입력", projectDir }).status, 0);
  assert.equal(tryRun(undefined, INSTALLED_SHARE).status, 0);
  assert.equal(tryRun(projectDir, undefined).status, 0);
  assert.equal(tryRun(projectDir, 42).status, 0);

  // 같은 실행 틀에서 재료가 있으면 막힌다: 위의 통과가 hook이 돌지 않아서가 아님을 보인다.
  assert.ok(blocked(tryRun(projectDir, INSTALLED_SHARE)));
});

test("SRG5: 막을 때 blocked 한 줄을 남긴다 (by share-run-guard, tool Bash, file_path .your-call/shared/, command 원문, prompt_id)", () => {
  const projectDir = project();

  tryRun(projectDir, INSTALLED_SHARE);

  const [line] = readLedger(projectDir, "s-srg").filter((entry) => entry.event === "blocked");
  assert.equal(line.by, "share-run-guard");
  assert.equal(line.tool, "Bash");
  assert.equal(line.file_path, ".your-call/shared/");
  assert.equal(line.command, INSTALLED_SHARE);
  assert.equal(line.prompt_id, "p-srg");
});

test("SRG6: 한 번 판단하는 데 Node 기동을 포함해 200ms를 넘지 않는다 (5회 중앙값)", () => {
  const projectDir = project();
  const durations = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    const run = tryRun(projectDir, i % 2 ? "node src/share.js" : INSTALLED_SHARE);
    durations.push(performance.now() - started);
    assert.equal(run.status, i % 2 ? 0 : 2, run.stderr);
  }

  assert.equal(existsSync(join(projectDir, ".your-call", "ledger", "s-srg.jsonl")), true);
  const median = durations.sort((a, b) => a - b)[2];
  assert.ok(median < 200, `중앙값 ${median.toFixed(0)}ms`);
});
