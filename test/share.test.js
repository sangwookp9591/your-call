import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, pluginDir } from "./helpers.js";

const THIS_SESSION = "s-this";
const LAST_WEEK_SESSION = "s-last-week";

/**
 * 스킬 본문의 !`node …/share.js $ARGUMENTS` 와 같은 방식으로 공유본 스크립트를 돌린다.
 * @param {string} cwd
 * @param {string[]} args
 * @param {string | undefined} [sessionId]
 */
function share(cwd, args, sessionId = THIS_SESSION) {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  if (sessionId !== undefined) env.CLAUDE_CODE_SESSION_ID = sessionId;
  return spawnSync(process.execPath, [join(pluginDir, "scripts", "share.js"), ...args], { cwd, env, encoding: "utf8" });
}

/** @param {string} projectDir @param {string} sessionId @param {Array<Record<string, unknown>>} lines */
function writeLedger(projectDir, sessionId, lines) {
  mkdirSync(join(projectDir, ".your-call", "ledger"), { recursive: true });
  for (const line of lines) {
    appendFileSync(join(projectDir, ".your-call", "ledger", `${sessionId}.jsonl`), `${JSON.stringify({ v: 1, session_id: sessionId, ...line })}\n`);
  }
}

/** @param {string} projectDir @param {string} sessionId */
const sharedPath = (projectDir, sessionId) => join(projectDir, ".your-call", "shared", `${sessionId}.md`);

/** @param {string} id @param {string} ts @param {string} text */
const prompt = (id, ts, text) => ({ event: "prompt", prompt_id: id, ts, text, source: null });

const COUPON_REQUEST = "why: 만료 판정을 서버 시간 기준으로 통일\n\n쿠폰 만료 로직 고쳐줘";
const COUPON_INTENT = "만료 판정을 서버 시간 기준으로 통일";
const OWN_ANSWER = "오프라인 쿠폰은 범위에서 뺀다";
const AI_LAST_WORDS = "쿠폰 만료 로직을 서버 시간 기준으로 바꿨습니다";
const DELEGATION_PROMPT = "src 아래에서 Date.now()를 쓰는 곳을 모두 찾아라";
const PRIVATE_FOLLOW_UP = "고객사 A의 정산 데이터는 여기 붙여 넣을게";
const AGENT_HAND_BACK = '<agent-message from="a1">\n[Subagent hand-back]';

/**
 * 턴 1: 사실이 다 있는 사람 입력 / 턴 2: 기계가 넣은 입력 / 턴 3: 사람 입력, 중단됨 / 턴 4: 사람 입력
 * @param {string} projectDir
 */
function couponSession(projectDir) {
  writeLedger(projectDir, THIS_SESSION, [
    { event: "session-open", prompt_id: null, ts: "2026-10-27T10:00:00.000Z" },
    prompt("p1", "2026-10-27T10:01:00.000Z", COUPON_REQUEST),
    { event: "intent", prompt_id: "p1", text: COUPON_INTENT },
    {
      event: "choice", prompt_id: "p1", header: "기준 시간", question: "만료 판정을 어느 시간 기준으로 할까요?",
      offered: [{ label: "서버 시간 (Recommended)", description: null }, { label: "클라이언트 시간", description: null }],
      recommended: ["서버 시간 (Recommended)"], chosen: ["서버 시간 (Recommended)"], rejected: ["클라이언트 시간"],
      other_text: OWN_ANSWER, notes: null, reason: null,
    },
    { event: "skill", prompt_id: "p1", name: "your-call:spec", invoked_by: "human" },
    { event: "agent", prompt_id: "p1", subagent_type: "Explore", description: "만료 판정 위치 조사", prompt: DELEGATION_PROMPT },
    { event: "edit", prompt_id: "p1", tool: "Edit", file_path: join(projectDir, "src", "coupon.ts") },
    { event: "blocked", prompt_id: "p1", tool: "Write", file_path: ".your-call/ledger/x.jsonl" },
    { event: "turn-close", prompt_id: "p1", last_message: AI_LAST_WORDS },
    prompt("p2", "2026-10-27T10:02:00.000Z", AGENT_HAND_BACK),
    prompt("p3", "2026-10-27T10:03:00.000Z", PRIVATE_FOLLOW_UP),
    prompt("p4", "2026-10-27T10:04:00.000Z", "계속"),
    { event: "interrupt", prompt_id: "p4", kind: "response" },
  ]);
}

/**
 * 공유본에서 "## <번호>." 로 시작하는 턴 절 하나
 * @param {string} markdown
 * @param {number} number
 */
function turnSection(markdown, number) {
  const start = markdown.indexOf(`\n## ${number}. `);
  assert.notEqual(start, -1, `턴 ${number} 절이 없음\n${markdown}`);
  const next = markdown.indexOf("\n## ", start + 1);
  return markdown.slice(start, next === -1 ? undefined : next);
}

test("SH1: 번호 없이 부르면 이번 세션의 턴을 /ledger와 같은 번호, 시각, 앞 80자로 나열하고 파일은 쓰지 않는다", () => {
  const projectDir = makeProjectDir();
  const longRequest = `쿠폰 ${"가".repeat(100)}`;
  writeLedger(projectDir, THIS_SESSION, [
    prompt("p1", "2026-10-27T10:01:00.000Z", COUPON_REQUEST),
    prompt("p2", "2026-10-27T10:02:00.000Z", longRequest),
  ]);

  const run = share(projectDir, []);

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /1\. \[2026-10-27 10:01Z\] why: 만료 판정을 서버 시간 기준으로 통일/);
  assert.ok(run.stdout.includes(`2. [2026-10-27 10:02Z] ${longRequest.slice(0, 80)}…`), run.stdout);
  assert.ok(!run.stdout.includes(longRequest.slice(0, 81)), "80자를 넘겨 보여 줌");
  assert.equal(existsSync(join(projectDir, ".your-call", "shared")), false);
});

test("SH2: 번호를 주면 .your-call/shared/<session_id>.md를 쓰고, 이미 있으면 새로 덮어쓴다", () => {
  const projectDir = makeProjectDir();
  couponSession(projectDir);

  const first = share(projectDir, ["1"]);
  assert.equal(first.status, 0, first.stderr);
  assert.ok(readFileSync(sharedPath(projectDir, THIS_SESSION), "utf8").includes(COUPON_REQUEST));

  const second = share(projectDir, ["3"]);
  assert.equal(second.status, 0, second.stderr);
  const rewritten = readFileSync(sharedPath(projectDir, THIS_SESSION), "utf8");
  assert.ok(rewritten.includes(PRIVATE_FOLLOW_UP));
  assert.ok(!rewritten.includes("쿠폰 만료 로직 고쳐줘"), "앞서 고른 원문이 남아 있음");
  assert.match(second.stdout, /\.your-call\/shared\/s-this\.md/);
});

test("SH3: 공유본에는 턴 순서대로 의도, 선택(제시된 것, AI 추천, 고른 것, 버린 것, 직접 쓴 답), 중단, 스킬, 위임 종류와 설명, 바꾼 파일 경로(프로젝트 기준 상대 경로), 막힌 쓰기가 들어간다", () => {
  const projectDir = makeProjectDir();
  couponSession(projectDir);

  const run = share(projectDir, ["4"]);

  assert.equal(run.status, 0, run.stderr);
  const shared = readFileSync(sharedPath(projectDir, THIS_SESSION), "utf8");
  const couponTurn = turnSection(shared, 1);
  assert.ok(couponTurn.includes(`의도: ${COUPON_INTENT}`), couponTurn);
  assert.ok(couponTurn.includes("만료 판정을 어느 시간 기준으로 할까요?"), couponTurn);
  assert.ok(couponTurn.includes("제시된 것: 서버 시간 (Recommended), 클라이언트 시간"), couponTurn);
  assert.ok(couponTurn.includes("AI 추천: 서버 시간 (Recommended)"), couponTurn);
  assert.ok(couponTurn.includes("고른 것: 서버 시간 (Recommended)"), couponTurn);
  assert.ok(couponTurn.includes("버린 것: 클라이언트 시간"), couponTurn);
  assert.ok(couponTurn.includes(`직접 쓴 답: "${OWN_ANSWER}"`), couponTurn);
  assert.ok(couponTurn.includes("스킬: your-call:spec (사람)"), couponTurn);
  assert.ok(couponTurn.includes('에이전트: Explore "만료 판정 위치 조사"'), couponTurn);
  assert.ok(couponTurn.includes("바꾼 파일: src/coupon.ts"), couponTurn);
  assert.ok(!shared.includes(projectDir), "프로젝트의 절대 경로가 들어감");
  assert.ok(couponTurn.includes("막힌 쓰기: Write .your-call/ledger/x.jsonl"), couponTurn);
  // 중단은 다음 입력(턴 4) 때 발견되지만 실제로 끊긴 것은 턴 3이다. /ledger와 같은 규칙.
  assert.ok(turnSection(shared, 3).includes("⚑ ✋ 중단 (응답 중)"), shared);
  assert.ok(shared.indexOf("\n## 1. ") < shared.indexOf("\n## 3. ") && shared.indexOf("\n## 3. ") < shared.indexOf("\n## 4. "));
});

test("SH4: 고른 번호의 턴에만 입력 원문이 들어가고, 나머지 턴의 제목에는 번호와 시각만 있으며 \"원문 공유 안 함\"이 남는다", () => {
  const projectDir = makeProjectDir();
  couponSession(projectDir);

  const run = share(projectDir, ["1"]);

  assert.equal(run.status, 0, run.stderr);
  const shared = readFileSync(sharedPath(projectDir, THIS_SESSION), "utf8");
  assert.ok(turnSection(shared, 1).includes("쿠폰 만료 로직 고쳐줘"), shared);
  const notShared = turnSection(shared, 3);
  assert.ok(notShared.startsWith("\n## 3. [2026-10-27 10:03Z] — 원문 공유 안 함"), notShared);
  assert.ok(!shared.includes(PRIVATE_FOLLOW_UP), "고르지 않은 입력의 원문이 들어감");
  assert.ok(!turnSection(shared, 4).includes("계속"), "고르지 않은 입력의 원문이 들어감");
});

test("SH5: AI의 마지막 말과 위임 원문은 들어가지 않는다", () => {
  const projectDir = makeProjectDir();
  couponSession(projectDir);

  const run = share(projectDir, ["1", "3", "4"]);

  assert.equal(run.status, 0, run.stderr);
  const shared = readFileSync(sharedPath(projectDir, THIS_SESSION), "utf8");
  assert.ok(shared.includes("에이전트: Explore"), "위임이 기록되지 않음 — 테스트가 아무것도 확인하지 않는다");
  assert.ok(!shared.includes(AI_LAST_WORDS), "AI의 마지막 말이 들어감");
  assert.ok(!shared.includes(DELEGATION_PROMPT), "위임 원문이 들어감");
});

test("SH6: 기계가 넣은 턴은 /ledger와 같은 번호를 받고 \"기계가 넣은 형식\"으로 표시되며, 원문은 고를 수 없다", () => {
  const projectDir = makeProjectDir();
  couponSession(projectDir);

  const listed = share(projectDir, []);
  assert.match(listed.stdout, /2\. \[2026-10-27 10:02Z\] — 기계가 넣은 형식/);

  const run = share(projectDir, ["1"]);
  assert.equal(run.status, 0, run.stderr);
  const shared = readFileSync(sharedPath(projectDir, THIS_SESSION), "utf8");
  assert.ok(turnSection(shared, 2).startsWith("\n## 2. [2026-10-27 10:02Z] — 기계가 넣은 형식"), shared);
  assert.ok(!shared.includes("Subagent hand-back"), "기계가 넣은 입력의 원문이 들어감");
});

test("SH7: 없는 번호나 기계가 넣은 턴의 번호가 하나라도 있으면 파일을 쓰지 않고, 어느 번호가 왜 안 되는지 알린다", () => {
  const projectDir = makeProjectDir();
  couponSession(projectDir);
  const turnsInSession = 4;
  const missingTurn = String(turnsInSession + 1);

  const run = share(projectDir, ["1", "2", missingTurn]);

  assert.equal(existsSync(sharedPath(projectDir, THIS_SESSION)), false);
  assert.match(run.stdout, /2번: 기계가 넣은 형식/);
  assert.match(run.stdout, new RegExp(`${missingTurn}번: 없는 번호`));
  assert.ok(!run.stdout.includes("1번:"), "고를 수 있는 번호까지 문제로 알림");
});

test("SH8: 같은 기록과 같은 번호면 바이트가 같은 파일이 나온다", () => {
  const projectDir = makeProjectDir();
  couponSession(projectDir);

  share(projectDir, ["1", "3"]);
  const first = readFileSync(sharedPath(projectDir, THIS_SESSION));
  share(projectDir, ["3", "1"]);
  const second = readFileSync(sharedPath(projectDir, THIS_SESSION));

  assert.ok(first.length > 0);
  assert.deepEqual(second, first);
});

test("SH9: 맨 위에 세션 id, 기간, ⚑ 개입 턴 수 / 사람 입력 턴 수, 원문을 공유한 번호가 있다", () => {
  const projectDir = makeProjectDir();
  couponSession(projectDir);

  share(projectDir, ["3", "1"]);

  const shared = readFileSync(sharedPath(projectDir, THIS_SESSION), "utf8");
  const header = shared.slice(0, shared.indexOf("\n## "));
  assert.ok(header.includes(THIS_SESSION), header);
  assert.ok(header.includes("2026-10-27 10:01Z ~ 2026-10-27 10:04Z"), header);
  // 사람 입력은 턴 1, 3, 4. 개입은 턴 1(선택)과 턴 3(중단).
  assert.ok(header.includes("⚑ 개입이 있는 턴: 2 / 3"), header);
  assert.ok(header.includes("원문을 공유한 턴: 1, 3"), header);
});

test("SH10: 원문을 고른 입력에 sk-…, ghp_…, AKIA…, 긴 hex 같은 문자열이 있으면 쓰지 않고 어느 번호인지 알린다. 의도·직접 쓴 답에도 적용한다", async (t) => {
  const tokenLike = {
    "sk-": `sk-${"a1B2".repeat(8)}`,
    "ghp_": `ghp_${"Zx9".repeat(12)}`,
    "AKIA": "AKIAIOSFODNN7EXAMPLE",
    "긴 hex": "9f".repeat(32),
  };
  for (const [kind, token] of Object.entries(tokenLike)) {
    await t.test(`원문에 ${kind}`, () => {
      const projectDir = makeProjectDir();
      writeLedger(projectDir, THIS_SESSION, [
        prompt("p1", "2026-10-27T10:01:00.000Z", "배포 설정 봐줘"),
        prompt("p2", "2026-10-27T10:02:00.000Z", `이 키로 해 봐 ${token}`),
      ]);
      const run = share(projectDir, ["1", "2"]);
      assert.equal(existsSync(sharedPath(projectDir, THIS_SESSION)), false);
      assert.match(run.stdout, /2번/);
      assert.ok(!run.stdout.includes(token), "알림에 토큰을 그대로 보여 줌");
    });
  }

  await t.test("원문을 고르지 않아도 의도와 직접 쓴 답은 검사한다", () => {
    const projectDir = makeProjectDir();
    writeLedger(projectDir, THIS_SESSION, [
      prompt("p1", "2026-10-27T10:01:00.000Z", "why: 배포\n\n해줘"),
      { event: "intent", prompt_id: "p1", text: `배포 키 ${tokenLike["ghp_"]}` },
      prompt("p2", "2026-10-27T10:02:00.000Z", "다음"),
      {
        event: "choice", prompt_id: "p2", header: "키", question: "어느 키?", offered: [{ label: "기존", description: null }],
        recommended: [], chosen: [], rejected: ["기존"], other_text: tokenLike["sk-"], notes: null, reason: null,
      },
    ]);
    const run = share(projectDir, ["2"]);
    assert.equal(existsSync(sharedPath(projectDir, THIS_SESSION)), false);
    assert.match(run.stdout, /1번/);
    assert.match(run.stdout, /2번/);
  });

  await t.test("git 커밋 해시(40자 hex)는 토큰으로 보지 않는다", () => {
    const projectDir = makeProjectDir();
    const commitHash = "7ad899e9718abee765a4df385568e26f5d98da35";
    writeLedger(projectDir, THIS_SESSION, [prompt("p1", "2026-10-27T10:01:00.000Z", `${commitHash} 되돌려줘`)]);
    const run = share(projectDir, ["1"]);
    assert.equal(run.status, 0, run.stderr);
    assert.ok(readFileSync(sharedPath(projectDir, THIS_SESSION), "utf8").includes(commitHash));
  });
});

test("SH11: /your-call:share <session_id> [번호...]로 지난 세션의 공유본도 만든다. 없으면 이번 세션만", () => {
  const projectDir = makeProjectDir();
  couponSession(projectDir);
  writeLedger(projectDir, LAST_WEEK_SESSION, [prompt("q1", "2026-10-20T09:00:00.000Z", "지난주 작업")]);

  const listed = share(projectDir, [LAST_WEEK_SESSION]);
  assert.match(listed.stdout, /1\. \[2026-10-20 09:00Z\] 지난주 작업/);
  assert.ok(!listed.stdout.includes("쿠폰"), "이번 세션의 턴이 섞임");

  const run = share(projectDir, [LAST_WEEK_SESSION, "1"]);
  assert.equal(run.status, 0, run.stderr);
  assert.ok(readFileSync(sharedPath(projectDir, LAST_WEEK_SESSION), "utf8").includes("지난주 작업"));
  assert.equal(existsSync(sharedPath(projectDir, THIS_SESSION)), false);

  const unknown = share(projectDir, ["../ledger/s-this", "1"]);
  assert.match(unknown.stdout, /기록이 없습니다/);
  assert.equal(existsSync(join(projectDir, ".your-call", "ledger", "s-this.md")), false);
});

test("SH12: /your-call:share는 사람만 부를 수 있고, 스크립트 출력을 그대로 보여 준다. AI는 공유본을 쓰거나 고치지 않고, 어떤 번호를 공유할지 추천하지 않는다", () => {
  const skill = readFileSync(join(pluginDir, "skills", "share", "SKILL.md"), "utf8");
  const [, frontmatter = "", body = ""] = skill.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
  assert.match(frontmatter, /^disable-model-invocation: true$/m);
  assert.equal(frontmatter.match(/^allowed-tools: (.*)$/m)?.[1], "Bash(node:*)", "공유본을 쓸 수 있는 도구가 허용됨");
  assert.match(body, /scripts\/share\.js" \$ARGUMENTS/);
  assert.match(body, /그대로 보여 준다/);
  assert.match(body, /공유본을 쓰거나 고치지 않는다/);
  assert.match(body, /추천하지 않는다/);
});
