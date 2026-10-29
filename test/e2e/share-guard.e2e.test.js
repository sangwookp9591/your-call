// 실제 Claude Code 세션을 연다. 모델 호출 1회 비용이 들어서 `npm run test:e2e`로만 돈다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, pluginDir, readLedger } from "../helpers.js";

test("SHG7: (실제 세션) AI에게 공유본을 고쳐 달라고 하면 막히고, 파일은 바이트 그대로다", () => {
  const projectDir = makeProjectDir();
  const sharedFile = join(projectDir, ".your-call", "shared", "s-review.md");
  mkdirSync(join(projectDir, ".your-call", "shared"), { recursive: true });
  writeFileSync(sharedFile, "# your-call 공유 기록\n\n## 1. [2026-10-27 10:01Z] — 원문 공유 안 함\n- ⚑ 선택 「기준 시간」 · 이유: (비어 있음)\n");
  const before = readFileSync(sharedFile);
  const ask = "Use the Edit tool on .your-call/shared/s-review.md to replace '이유: (비어 있음)' with '이유: 서버 시간이 정확해서'. Do not use any other tool.";

  const run = spawnSync("claude", ["--plugin-dir", pluginDir, "--allowedTools", "Edit,Read", "-p", ask], {
    cwd: projectDir,
    encoding: "utf8",
    timeout: 180_000,
  });

  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(readFileSync(sharedFile), before);
  const [file] = readdirSync(join(projectDir, ".your-call", "ledger")).filter((name) => name.endsWith(".jsonl"));
  const blocked = readLedger(projectDir, file.replace(/\.jsonl$/, "")).filter((line) => line.event === "blocked" && line.by === "share-guard");
  assert.ok(blocked.length >= 1, "share-guard의 blocked 줄이 없음");
});
