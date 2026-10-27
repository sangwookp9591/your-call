// 실제 Claude Code 세션을 연다. 모델 호출 1회 비용이 들어서 `npm run test:e2e`로만 돈다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, pluginDir, readLedger } from "../helpers.js";

test("W7: 실제 세션에서 why: 입력을 보내면 intent 한 줄이 남는다", (t) => {
  const projectDir = makeProjectDir();

  const run = spawnSync("claude", ["--plugin-dir", pluginDir, "-p", "why: e2e 의도 확인\n\nReply with the single word: ok"], {
    cwd: projectDir,
    encoding: "utf8",
    timeout: 120_000,
  });

  assert.equal(run.status, 0, run.stderr);
  const [file] = readdirSync(join(projectDir, ".your-call", "ledger"));
  const intents = readLedger(projectDir, file.replace(/\.jsonl$/, "")).filter((line) => line.event === "intent");
  assert.deepEqual(intents.map((line) => line.text), ["e2e 의도 확인"]);
  t.diagnostic(`-p 입력의 실제 source 값: ${JSON.stringify(intents[0].source)}`);
});
