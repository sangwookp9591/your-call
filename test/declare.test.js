import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, pluginDir } from "./helpers.js";

const skillFile = join(pluginDir, "skills", "declare", "SKILL.md");

/**
 * 스킬 본문의 !`node …/intents.js` 와 같은 방식으로 의도 목록 스크립트를 돌린다.
 * @param {string} cwd Bash가 있는 폴더
 * @param {string | undefined} sessionId CLAUDE_CODE_SESSION_ID
 */
function listIntents(cwd, sessionId) {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  if (sessionId !== undefined) env.CLAUDE_CODE_SESSION_ID = sessionId;
  return spawnSync(process.execPath, [join(pluginDir, "scripts", "intents.js")], { cwd, env, encoding: "utf8" });
}

/** @param {string} sessionId @param {Array<Record<string, unknown>>} entries */
function projectWithLedger(sessionId, entries) {
  const projectDir = makeProjectDir();
  mkdirSync(join(projectDir, ".your-call", "ledger"), { recursive: true });
  for (const entry of entries) {
    appendFileSync(join(projectDir, ".your-call", "ledger", `${sessionId}.jsonl`), `${JSON.stringify({ v: 1, session_id: sessionId, ...entry })}\n`);
  }
  return projectDir;
}

const sampleSession = [
  { ts: "2026-10-27T10:30:00.000Z", event: "session-open", source: "startup" },
  { ts: "2026-10-27T10:31:00.000Z", event: "prompt", text: "why: 만료 판정을 서버 시간 기준으로 통일\n\n쿠폰 만료 로직 고쳐줘" },
  { ts: "2026-10-27T10:31:00.000Z", event: "intent", text: "만료 판정을 서버 시간 기준으로 통일" },
  { ts: "2026-10-27T10:40:00.000Z", event: "intent", text: "오프라인 쿠폰은 이번 범위에서 뺀다\n다음 분기에 따로 본다" },
  { ts: "2026-10-27T10:41:00.000Z", event: "choice", chosen: ["B안"], reason: null },
];

/** 스킬 파일의 frontmatter와 본문 */
function readSkill() {
  const [, frontmatter, body] = readFileSync(skillFile, "utf8").match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
  return { frontmatter: frontmatter ?? "", body: body ?? "" };
}

test("DC1: 이번 세션에 기록된 의도를 시각과 함께 원문 그대로 보여 주고, 다른 줄은 보여 주지 않는다", () => {
  const projectDir = projectWithLedger("s-dc", sampleSession);
  const otherSession = { v: 1, ts: "2026-10-27T09:00:00.000Z", session_id: "s-other", event: "intent", text: "다른 세션의 의도" };
  appendFileSync(join(projectDir, ".your-call", "ledger", "s-other.jsonl"), `${JSON.stringify(otherSession)}\n`);

  const run = listIntents(projectDir, "s-dc");

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /2026-10-27T10:31:00\.000Z/);
  assert.match(run.stdout, /만료 판정을 서버 시간 기준으로 통일/);
  assert.match(run.stdout, /오프라인 쿠폰은 이번 범위에서 뺀다\n.*다음 분기에 따로 본다/);
  assert.doesNotMatch(run.stdout, /쿠폰 만료 로직 고쳐줘/);
  assert.doesNotMatch(run.stdout, /다른 세션의 의도/);
});

test("DC2: 의도가 없으면 무엇을, 왜를 묻고 why: 형식을 안내하며, 예시 의도나 요약을 만들지 말라고 지시문에 적혀 있다", () => {
  const projectDir = projectWithLedger("s-empty", sampleSession.filter((entry) => entry.event !== "intent"));
  const run = listIntents(projectDir, "s-empty");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /기록된 의도가 없습니다/);

  const { body } = readSkill();
  assert.match(body, /why:/);
  assert.match(body, /무엇을/);
  assert.match(body, /왜/);
  assert.match(body, /예시/);
  assert.match(body, /대신 쓰지/);
});

test("DC3: 스킬은 기록을 읽기만 하고, 허용 도구는 node 실행뿐이다", () => {
  const { frontmatter } = readSkill();

  assert.match(frontmatter, /^allowed-tools: Bash\(node:\*\)$/m);
});

test("DC4: 세션 id가 없으면 추측하지 않고 알 수 없다고 말하고, 기록 폴더가 없으면 아직 기록이 없다고 말한다", () => {
  const projectDir = projectWithLedger("s-dc", sampleSession);

  const unknown = listIntents(projectDir, undefined);
  assert.equal(unknown.status, 0, unknown.stderr);
  assert.match(unknown.stdout, /세션을 알 수 없습니다/);
  assert.doesNotMatch(unknown.stdout, /만료 판정/);

  const empty = listIntents(makeProjectDir(), "s-dc");
  assert.equal(empty.status, 0, empty.stderr);
  assert.match(empty.stdout, /아직 기록이 없습니다/);

  // 같은 실행 틀에서 세션과 기록이 있으면 의도가 나온다: 위의 안내가 스크립트가 돌지 않아서가 아님을 보인다.
  assert.match(listIntents(projectDir, "s-dc").stdout, /만료 판정/);
});

test("DC5: Bash가 하위 폴더에 있어도 위로 올라가며 기록 폴더를 찾는다", () => {
  const projectDir = projectWithLedger("s-dc", sampleSession);
  const deep = join(projectDir, "src", "coupon", "expiry");
  mkdirSync(deep, { recursive: true });

  const run = listIntents(deep, "s-dc");

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /만료 판정을 서버 시간 기준으로 통일/);
});

test("DC6: AI가 스스로 부르지 않는다 (사람만 /your-call:declare 로 부른다)", () => {
  const { frontmatter } = readSkill();

  assert.match(frontmatter, /^disable-model-invocation: true$/m);
});
