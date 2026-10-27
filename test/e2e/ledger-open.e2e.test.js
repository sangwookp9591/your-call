// 실제 Claude Code 세션을 연다. 모델 호출 1회 비용이 들어서 `npm test`에는 포함하지 않고 `npm run test:e2e`로만 돈다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, pluginDir } from "../helpers.js";

test("L9: 플러그인을 불러와 실제 세션을 열면 그 세션의 기록 파일이 생긴다", () => {
  const projectDir = makeProjectDir();

  const run = spawnSync("claude", ["--plugin-dir", pluginDir, "-p", "Reply with the single word: ok"], {
    cwd: projectDir,
    encoding: "utf8",
    timeout: 120_000,
  });

  assert.equal(run.status, 0, run.stderr);
  const ledgerDir = join(projectDir, ".your-call", "ledger");
  const [file, ...others] = readdirSync(ledgerDir);
  assert.deepEqual(others, []);
  const opened = JSON.parse(readFileSync(join(ledgerDir, file), "utf8").split("\n")[0]);
  assert.equal(opened.event, "session-open");
  assert.equal(opened.source, "startup");
});
