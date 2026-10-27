import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, pluginDir } from "./helpers.js";

/**
 * 스킬 본문의 !`node …/ledger-view.js $ARGUMENTS` 와 같은 방식으로 화면 스크립트를 돌린다.
 * @param {string} cwd
 * @param {string | undefined} sessionId
 * @param {string[]} [args]
 */
function view(cwd, sessionId, args = []) {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  if (sessionId !== undefined) env.CLAUDE_CODE_SESSION_ID = sessionId;
  return spawnSync(process.execPath, [join(pluginDir, "scripts", "ledger-view.js"), ...args], { cwd, env, encoding: "utf8" });
}

/** @param {string} projectDir @param {string} sessionId @param {Array<Record<string, unknown>>} lines */
function writeLedger(projectDir, sessionId, lines) {
  mkdirSync(join(projectDir, ".your-call", "ledger"), { recursive: true });
  for (const line of lines) {
    appendFileSync(join(projectDir, ".your-call", "ledger", `${sessionId}.jsonl`), `${JSON.stringify({ v: 1, session_id: sessionId, ...line })}\n`);
  }
}

/** @param {string} id @param {string} ts @param {string} text */
const prompt = (id, ts, text) => ({ event: "prompt", prompt_id: id, ts, text, source: null });
const longReply = "쿠폰 만료 로직을 서버 시간 기준으로 바꿨습니다. 테스트 12개가 통과합니다. 클라이언트 시간을 쓰던 곳 세 군데도 함께 고쳤고, 오프라인 쿠폰은 범위에서 뺐습니다.";

/**
 * 사실이 다 들어 있는 턴 하나 + 기계 턴 하나 + 중단된 턴 하나 + 단순한 턴 fillers개
 * @param {string} projectDir
 * @param {number} [fillers]
 */
function busySession(projectDir, fillers = 25) {
  const lines = [
    { event: "session-open", prompt_id: null, ts: "2026-10-27T10:00:00.000Z" },
    prompt("p01", "2026-10-27T10:01:00.000Z", "why: 만료 판정을 서버 시간 기준으로 통일\n\n쿠폰 만료 로직 고쳐줘"),
    { event: "intent", prompt_id: "p01", text: "만료 판정을 서버 시간 기준으로 통일" },
    { event: "choice", prompt_id: "p01", header: "기준 시간", question: "어디서?", recommended: ["서버 시간 (Recommended)"], chosen: ["서버 시간 (Recommended)"], rejected: ["클라이언트 시간"], other_text: null },
    { event: "skill", prompt_id: "p01", name: "dataviz", invoked_by: "ai" },
    { event: "agent", prompt_id: "p01", subagent_type: "Explore", description: "만료 판정 위치 조사" },
    { event: "edit", prompt_id: "p01", tool: "Edit", file_path: join(projectDir, "src", "coupon.ts") },
    { event: "blocked", prompt_id: "p01", tool: "Write", file_path: ".your-call/ledger/x.jsonl" },
    { event: "turn-close", prompt_id: "p01", last_message: longReply },
    prompt("p02", "2026-10-27T10:02:00.000Z", '<agent-message from="a1">\n[Subagent hand-back]'),
    prompt("p03", "2026-10-27T10:03:00.000Z", "1부터 30까지 설명해줘"),
    prompt("p04", "2026-10-27T10:04:00.000Z", "계속"),
    { event: "interrupt", prompt_id: "p04", kind: "response" },
  ];
  for (let i = 5; i < 5 + fillers; i++) lines.push(prompt(`p${String(i).padStart(2, "0")}`, `2026-10-27T10:${String(i).padStart(2, "0")}:00.000Z`, `${i}번째 입력`));
  writeLedger(projectDir, "s-lv", lines);
}

test("LV1: 이번 세션 요약과 최근 20턴을 보여 주고, 턴마다 사실을 먼저, AI의 마지막 말은 끝에 80자까지 둔다", () => {
  const projectDir = makeProjectDir();
  busySession(projectDir);
  writeLedger(projectDir, "s-lv", [{ event: "choice", question: "옛 기록", chosen: ["A"], other_text: null }]);

  const run = view(projectDir, "s-lv");
  assert.equal(run.status, 0, run.stderr);
  const out = run.stdout;

  assert.match(out, /사람 입력 28턴 \(기계가 넣은 형식이라 제외: 1턴\)/);
  assert.match(out, /⚑ 개입이 있는 턴: 2 \/ 28 \(7%\)/);
  assert.match(out, /선택 1회 \(AI 추천 그대로 1회, 직접 쓴 답 0회\) · 중단 1회/);
  assert.match(out, /의도를 밝힌 턴: 1 \/ 28 · 막힌 쓰기: 1회/);
  assert.match(out, /턴에 묶지 못한 ⚑ 1개/);
  assert.match(out, /최근 턴 \(20 \/ 29\)/);
  assert.doesNotMatch(out, /### 9\. /);
  assert.match(out, /### 10\. /);

  const small = makeProjectDir();
  busySession(small, 1);
  const full = view(small, "s-lv").stdout;
  const turn = full.slice(full.indexOf("### 1. "), full.indexOf("### 2. "));
  assert.match(turn, /why: 만료 판정을 서버 시간 기준으로 통일$/m);
  assert.doesNotMatch(turn, /쿠폰 만료 로직 고쳐줘/);
  const order = ["의도:", "⚑ 선택", "스킬:", "에이전트:", "바꾼 파일: src/coupon.ts", "막힌 쓰기:", "🤖 AI의 마지막 말:"].map((label) => turn.indexOf(label));
  assert.ok(order.every((at) => at >= 0), JSON.stringify(order));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(turn, new RegExp(`🤖 AI의 마지막 말: "${longReply.slice(0, 80)}…"`));
  assert.match(full, /### 2\. .*기계가 넣은 형식/);
  assert.match(full.slice(full.indexOf("### 3. "), full.indexOf("### 4. ")), /⚑ ✋ 중단 \(응답 중\)/);
});

test("LV2: all을 주면 모든 세션을 합친 요약과 최근 세션 10개를 한 줄씩 보여 준다", () => {
  const projectDir = makeProjectDir();
  busySession(projectDir);
  writeLedger(projectDir, "s-older", [
    { event: "session-open", prompt_id: null, ts: "2026-10-26T09:00:00.000Z" },
    prompt("q1", "2026-10-26T09:01:00.000Z", "어제 입력"),
    { event: "interrupt", prompt_id: "q2", kind: "response" },
    prompt("q2", "2026-10-26T09:02:00.000Z", "어제 두 번째"),
  ]);

  const run = view(projectDir, undefined, ["all"]);

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /프로젝트 전체 기록 \(2개 세션\)/);
  assert.match(run.stdout, /사람 입력 30턴/);
  assert.match(run.stdout, /⚑ 개입이 있는 턴: 3 \/ 30 \(10%\)/);
  const sessions = run.stdout.slice(run.stdout.indexOf("최근 세션")).split("\n").filter((line) => line.startsWith("- "));
  assert.equal(sessions.length, 2);
  assert.match(sessions[0], /2026-10-27/);
  assert.match(sessions[1], /2026-10-26.*사람 2턴.*⚑ 1턴 \(50%\)/);
});

test("LV3: 세션을 모르거나 기록이 없으면 /declare와 같은 안내를 한다", () => {
  const projectDir = makeProjectDir();
  busySession(projectDir);

  assert.match(view(projectDir, undefined).stdout, /세션을 알 수 없습니다/);
  assert.match(view(makeProjectDir(), "s-lv").stdout, /아직 기록이 없습니다/);
  assert.match(view(makeProjectDir(), undefined, ["all"]).stdout, /아직 기록이 없습니다/);
  assert.match(view(projectDir, "s-처음-보는-세션").stdout, /이번 세션에는 아직 기록이 없습니다/);

  // 같은 실행 틀에서 세션과 기록이 있으면 요약이 나온다: 위의 안내가 스크립트가 돌지 않아서가 아님을 보인다.
  assert.match(view(projectDir, "s-lv").stdout, /사람 입력 28턴/);
});

test("LV4: 사람만 부르고, node만 허용하며, 보여 주기만 하고 해석이나 판정을 하지 말라고 적혀 있다", () => {
  const [, frontmatter, body] = readFileSync(join(pluginDir, "skills", "ledger", "SKILL.md"), "utf8").match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];

  assert.match(frontmatter, /^disable-model-invocation: true$/m);
  assert.match(frontmatter, /^allowed-tools: Bash\(node:\*\)$/m);
  assert.match(body, /ledger-view\.js" \$ARGUMENTS/);
  assert.match(body, /해석/);
  assert.match(body, /판정/);
});
