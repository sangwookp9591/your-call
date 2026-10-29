// 실제 Claude Code 세션을 연다. 모델 호출 비용이 들어서 `npm run test:e2e`로만 돈다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, pluginDir } from "../helpers.js";

/** @param {string} projectDir @param {string} prompt */
const session = (projectDir, prompt) =>
  spawnSync("claude", ["--plugin-dir", pluginDir, "-p", prompt], { cwd: projectDir, encoding: "utf8", timeout: 600_000 });

test("SH12: /your-call:share는 사람만 부를 수 있고, 스크립트 출력을 그대로 보여 준다. AI는 공유본을 쓰거나 고치지 않고, 어떤 번호를 공유할지 추천하지 않는다", () => {
  const projectDir = makeProjectDir();
  mkdirSync(join(projectDir, ".your-call", "ledger"), { recursive: true });
  const first = session(projectDir, "why: 공유본 시험\n\n안녕이라고만 답해줘");
  assert.equal(first.status, 0, first.stderr);
  const [ledgerFile] = readdirSync(join(projectDir, ".your-call", "ledger")).filter((name) => name.endsWith(".jsonl"));
  const sessionId = ledgerFile.replace(/\.jsonl$/, "");

  const listed = session(projectDir, `/your-call:share ${sessionId}`);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /1\. \[[^\]]+\] why: 공유본 시험/, listed.stdout);
  assert.equal(existsSync(join(projectDir, ".your-call", "shared")), false, "번호 없이 불렀는데 공유본이 생김");

  const written = session(projectDir, `/your-call:share ${sessionId} 1`);
  assert.equal(written.status, 0, written.stderr);
  assert.match(written.stdout, /\.your-call\/shared\//, written.stdout);
  const shared = readFileSync(join(projectDir, ".your-call", "shared", `${sessionId}.md`), "utf8");
  assert.ok(shared.includes("안녕이라고만 답해줘"), shared);
  assert.ok(shared.includes("- 의도: 공유본 시험"), shared);
});
