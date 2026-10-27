import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseHookInput } from "../plugins/your-call/lib/hook-input.js";

const hookInputModule = fileURLToPath(new URL("../plugins/your-call/lib/hook-input.js", import.meta.url));

/**
 * hook이 실제로 받는 것처럼 stdin으로 넣어서 readHookInput의 결과를 받는다.
 * @param {string} stdin
 */
function readThroughStdin(stdin) {
  const script = `import { readHookInput } from ${JSON.stringify(hookInputModule)};
    process.stdout.write(JSON.stringify(await readHookInput()));`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { input: stdin, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test("I1: 올바른 JSON 객체가 들어오면 그 객체를 돌려준다", () => {
  const sessionStart = { session_id: "abc", hook_event_name: "SessionStart" };

  assert.deepEqual(parseHookInput(JSON.stringify(sessionStart)), { ok: true, value: sessionStart });
  assert.deepEqual(readThroughStdin(JSON.stringify(sessionStart)), { ok: true, value: sessionStart });
});

test("I2: stdin이 비어 있으면 예외 없이 empty 실패를 돌려준다", () => {
  assert.deepEqual(parseHookInput(""), { ok: false, reason: "empty" });
  assert.deepEqual(parseHookInput("  \n"), { ok: false, reason: "empty" });
  assert.deepEqual(readThroughStdin(""), { ok: false, reason: "empty" });
});

test("I3: JSON이 아니면 예외 없이 invalid-json 실패를 돌려준다", () => {
  assert.deepEqual(parseHookInput("{session_id: abc"), { ok: false, reason: "invalid-json" });
});

test("I4: JSON이지만 객체가 아니면 예외 없이 not-object 실패를 돌려준다", () => {
  assert.deepEqual(parseHookInput("[1, 2]"), { ok: false, reason: "not-object" });
  assert.deepEqual(parseHookInput("42"), { ok: false, reason: "not-object" });
  assert.deepEqual(parseHookInput("null"), { ok: false, reason: "not-object" });
});
