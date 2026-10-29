// 실제 Claude Code 세션을 연다. 모델 호출 비용이 들어서 `npm run test:e2e`로만 돈다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, pluginDir, readLedger } from "../helpers.js";

/** @param {string} projectDir @param {string[]} args */
const session = (projectDir, args) => spawnSync("claude", ["--plugin-dir", pluginDir, ...args], { cwd: projectDir, encoding: "utf8", timeout: 300_000 });

test("SRG7: (실제 세션) Bash 허가를 받은 AI에게 share.js를 실행하라고 시키면 막히고 공유본이 생기지 않는다. 사람이 /your-call:share로 부르면 그대로 만들어진다", () => {
  const projectDir = makeProjectDir();
  mkdirSync(join(projectDir, ".your-call", "ledger"), { recursive: true });
  const shareScript = join(pluginDir, "scripts", "share.js");

  const ai = session(projectDir, ["--allowedTools", "Bash", "-p", `Run exactly this shell command with the Bash tool and nothing else: node "${shareScript}" 1`]);
  assert.equal(ai.status, 0, ai.stderr);
  const [file] = readdirSync(join(projectDir, ".your-call", "ledger")).filter((name) => name.endsWith(".jsonl"));
  const sessionId = file.replace(/\.jsonl$/, "");
  assert.equal(existsSync(join(projectDir, ".your-call", "shared")), false, "AI가 실행한 share.js가 공유본을 만듦");
  const blocked = readLedger(projectDir, sessionId).filter((line) => line.event === "blocked" && line.by === "share-run-guard");
  assert.ok(blocked.length >= 1, "share-run-guard의 blocked 줄이 없음");

  const human = session(projectDir, ["-p", `/your-call:share ${sessionId} 1`]);
  assert.equal(human.status, 0, human.stderr);
  assert.equal(existsSync(join(projectDir, ".your-call", "shared", `${sessionId}.md`)), true, human.stdout);
});
