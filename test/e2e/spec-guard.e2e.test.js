// 실제 Claude Code 세션을 연다. 모델 호출 1회 비용이 들어서 `npm run test:e2e`로만 돈다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, pluginDir, readLedger } from "../helpers.js";

test("SG7: 쓰기 허가를 받은 실제 세션에서도 cases.md를 쓰라고 시키면 막히고 파일이 생기지 않는다", () => {
  const projectDir = makeProjectDir();
  const ask = "Use the Write tool to create the file .your-call/spec/coupon-expiry/cases.md containing '- C1: written by AI'. Do not use any other tool.";

  const run = spawnSync("claude", ["--plugin-dir", pluginDir, "--allowedTools", "Write", "-p", ask], {
    cwd: projectDir,
    encoding: "utf8",
    timeout: 180_000,
  });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(existsSync(join(projectDir, ".your-call", "spec", "coupon-expiry", "cases.md")), false);
  const [file] = readdirSync(join(projectDir, ".your-call", "ledger")).filter((name) => name.endsWith(".jsonl"));
  const blocked = readLedger(projectDir, file.replace(/\.jsonl$/, "")).filter((line) => line.event === "blocked" && line.by === "spec-guard");
  assert.ok(blocked.length >= 1, "spec-guard의 blocked 줄이 없음");
});
