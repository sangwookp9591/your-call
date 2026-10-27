// 실제 Claude Code 세션을 연다. 모델 호출 1회 비용이 들어서 `npm run test:e2e`로만 돈다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, pluginDir, readLedger } from "../helpers.js";

test("PC3: 실제 세션에서 Write로 파일을 만들면 edit 줄의 prompt_id가 그 입력의 prompt 줄과 같다", () => {
  const projectDir = makeProjectDir();

  const run = spawnSync(
    "claude",
    ["--plugin-dir", pluginDir, "--allowedTools", "Write", "-p", "Use the Write tool to create hello.txt containing the word hi. Do not use any other tool."],
    { cwd: projectDir, encoding: "utf8", timeout: 180_000 },
  );

  assert.equal(run.status, 0, run.stderr);
  const [file] = readdirSync(join(projectDir, ".your-call", "ledger")).filter((name) => name.endsWith(".jsonl"));
  const lines = readLedger(projectDir, file.replace(/\.jsonl$/, ""));
  const [prompt] = lines.filter((line) => line.event === "prompt");
  const [edit] = lines.filter((line) => line.event === "edit");
  assert.equal(typeof prompt.prompt_id, "string");
  assert.equal(edit.prompt_id, prompt.prompt_id);
});
