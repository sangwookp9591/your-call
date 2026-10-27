// 실제 Claude Code 세션을 두 번 연다(같은 세션 이어 가기). 모델 호출 2회 비용이 들어서 `npm run test:e2e`로만 돈다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, pluginDir, readLedger } from "../helpers.js";

test("LV5: 실제 세션 뒤에 /your-call:ledger 를 부르면 응답에 요약이 나온다", () => {
  const projectDir = makeProjectDir();
  /** @param {string[]} args */
  const claude = (args) =>
    spawnSync("claude", ["--plugin-dir", pluginDir, ...args], { cwd: projectDir, encoding: "utf8", timeout: 180_000 });

  const first = claude(["-p", "why: e2e 기록 보기\n\nReply with the single word: ok"]);
  assert.equal(first.status, 0, first.stderr);
  const ledgerDir = join(projectDir, ".your-call", "ledger");
  const sessionId = readdirSync(ledgerDir).filter((name) => name.endsWith(".jsonl"))[0].replace(/\.jsonl$/, "");

  const second = claude(["--resume", sessionId, "-p", "/your-call:ledger"]);
  assert.equal(second.status, 0, second.stderr);

  const lastMessages = readLedger(projectDir, sessionId)
    .filter((line) => line.event === "turn-close")
    .map((line) => String(line.last_message));
  assert.ok(lastMessages.some((message) => message.includes("사람 입력")), lastMessages.join("\n---\n"));
});
