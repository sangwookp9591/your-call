// 실제 Claude Code 세션을 연다. 모델 호출 1회 비용이 들어서 `npm run test:e2e`로만 돈다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, pluginDir, readLedger } from "../helpers.js";

test("P8: 실제 세션에서 보낸 입력이 기록에 원문 그대로 남는다", () => {
  const projectDir = makeProjectDir();
  const sent = 'Reply with the single word: ok\n두 번째 줄 "따옴표"';

  const run = spawnSync("claude", ["--plugin-dir", pluginDir, "-p", sent], {
    cwd: projectDir,
    encoding: "utf8",
    timeout: 120_000,
  });

  assert.equal(run.status, 0, run.stderr);
  const [file] = readdirSync(join(projectDir, ".your-call", "ledger"));
  const prompts = readLedger(projectDir, file.replace(/\.jsonl$/, "")).filter((line) => line.event === "prompt");
  assert.deepEqual(prompts.map((line) => line.text), [sent]);
});
