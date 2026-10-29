import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, pluginDir } from "./helpers.js";

/** 사용자의 git 설정(서명, hook)이 끼어들지 않게 한다. pr-context.js도 이 환경을 물려받는다. */
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "tester",
  GIT_AUTHOR_EMAIL: "tester@example.com",
  GIT_COMMITTER_NAME: "tester",
  GIT_COMMITTER_EMAIL: "tester@example.com",
};
const BRANCH = "feature/coupon";
const DRAFT = join(".your-call", "pr", "feature-coupon.md");

/** @param {string} cwd @param {string[]} args */
function git(cwd, ...args) {
  const run = spawnSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
  assert.equal(run.status, 0, `git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout;
}

/** @param {string} cwd @param {string[]} [args] */
function prContext(cwd, args = []) {
  return spawnSync(process.execPath, [join(pluginDir, "scripts", "pr-context.js"), ...args], { cwd, env: GIT_ENV, encoding: "utf8" });
}

/** @param {string} projectDir @param {string} sessionId @param {Array<Record<string, unknown>>} lines */
function writeLedger(projectDir, sessionId, lines) {
  mkdirSync(join(projectDir, ".your-call", "ledger"), { recursive: true });
  for (const line of lines) {
    appendFileSync(join(projectDir, ".your-call", "ledger", `${sessionId}.jsonl`), `${JSON.stringify({ v: 1, session_id: sessionId, ...line })}\n`);
  }
}

/**
 * 공유본은 3-1의 /your-call:share가 만든 그대로 쓴다. 형식이 두 컴포넌트 사이의 계약이다.
 * @param {string} projectDir
 * @param {string} sessionId
 * @param {...string} numbers
 */
function share(projectDir, sessionId, ...numbers) {
  const run = spawnSync(process.execPath, [join(pluginDir, "scripts", "share.js"), sessionId, ...numbers], { cwd: projectDir, encoding: "utf8" });
  assert.match(run.stdout, /공유본을 썼습니다/, run.stdout);
}

/** @param {string} id @param {string} ts @param {string} text */
const prompt = (id, ts, text) => ({ event: "prompt", prompt_id: id, ts, text, source: null });

const PRIVATE_REQUEST = "고객사 A 정산 데이터 기준으로 배송비도 고쳐";
const AI_LAST_WORDS = "배송비 계산을 서버로 옮겼습니다";

/**
 * 턴 1: 의도 + 이유가 빈 선택 + 파일 수정 (뒤 턴에서 중단 발견)
 * 턴 2: 기계가 넣은 입력, 파일 수정 → AI 혼자
 * 턴 3: 의도 없는 사람 입력, 파일 수정 → AI 혼자. 원문은 공유하지 않는다
 * 턴 4: 사람 입력, 수정 없음
 * @param {string} projectDir
 */
function couponSession(projectDir) {
  writeLedger(projectDir, "s-coupon", [
    prompt("p1", "2026-10-27T10:01:00.000Z", "why: 만료 판정을 서버 시간 기준으로 통일\n\n쿠폰 만료 로직 고쳐줘"),
    { event: "intent", prompt_id: "p1", text: "만료 판정을 서버 시간 기준으로 통일" },
    {
      event: "choice", prompt_id: "p1", header: "기준 시간", question: "만료 판정을 어느 시간 기준으로 할까요?",
      offered: [{ label: "서버 시간 (Recommended)" }, { label: "클라이언트 시간" }],
      recommended: ["서버 시간 (Recommended)"], chosen: ["서버 시간 (Recommended)"], rejected: ["클라이언트 시간"],
      other_text: null, notes: null, reason: null,
    },
    { event: "edit", prompt_id: "p1", tool: "Edit", file_path: join(projectDir, "src", "coupon.ts") },
    prompt("p2", "2026-10-27T10:02:00.000Z", '<agent-message from="a1">\n[Subagent hand-back]'),
    { event: "interrupt", prompt_id: "p2", kind: "tool-use" },
    { event: "edit", prompt_id: "p2", tool: "Write", file_path: join(projectDir, "src", "agent-made.ts") },
    prompt("p3", "2026-10-27T10:03:00.000Z", PRIVATE_REQUEST),
    { event: "edit", prompt_id: "p3", tool: "Edit", file_path: join(projectDir, "src", "shipping.ts") },
    { event: "turn-close", prompt_id: "p3", last_message: AI_LAST_WORDS },
    prompt("p4", "2026-10-27T10:04:00.000Z", "고마워"),
  ]);
}

/**
 * main에 커밋된 지난 공유본 하나, 브랜치에서 커밋한 공유본(s-coupon) 하나, 커밋하지 않은 공유본(s-draft) 하나.
 * @returns {string}
 */
function repoOnBranch() {
  const projectDir = makeProjectDir();
  git(projectDir, "init", "-q", "-b", "main");
  mkdirSync(join(projectDir, ".your-call", "spec", "old-work"), { recursive: true });
  writeFileSync(join(projectDir, ".your-call", ".gitignore"), "ledger/\n");
  writeFileSync(join(projectDir, ".your-call", "spec", "old-work", "cases.md"), "- C1: 지난 작업의 케이스\n");
  writeLedger(projectDir, "s-old", [prompt("o1", "2026-10-20T09:00:00.000Z", "지난주 작업")]);
  share(projectDir, "s-old", "1");
  git(projectDir, "add", "-A");
  git(projectDir, "commit", "-q", "-m", "base");

  git(projectDir, "checkout", "-q", "-b", BRANCH);
  couponSession(projectDir);
  share(projectDir, "s-coupon", "1");
  git(projectDir, "add", ".your-call/shared");
  git(projectDir, "commit", "-q", "-m", "share coupon");
  writeLedger(projectDir, "s-draft", [prompt("d1", "2026-10-27T11:00:00.000Z", "마무리")]);
  share(projectDir, "s-draft", "1");
  return projectDir;
}

/** @param {string} projectDir */
const readDraft = (projectDir) => readFileSync(join(projectDir, DRAFT), "utf8");

/** @param {string} markdown @param {string} heading 예: "## ⚑ 개입 지점" */
function section(markdown, heading) {
  const start = markdown.indexOf(`\n${heading}\n`);
  assert.notEqual(start, -1, `${heading} 절이 없음\n${markdown}`);
  const next = markdown.indexOf("\n## ", start + 1);
  return markdown.slice(start, next === -1 ? undefined : next);
}

test("PC1: /your-call:pr-context [base]는 base(기본 main)에서 갈라진 뒤 이 브랜치에서 바뀌거나 새로 생긴 .your-call/shared/*.md만 읽는다. 커밋되지 않은 공유본도 읽되 \"아직 커밋되지 않음\"으로 표시한다", () => {
  const projectDir = repoOnBranch();

  const run = prContext(projectDir);

  assert.equal(run.status, 0, run.stderr);
  const records = section(readDraft(projectDir), "## 기록과 확정 케이스");
  assert.match(records, /s-coupon\.md/);
  assert.match(records, /s-draft\.md.*아직 커밋되지 않음/);
  assert.doesNotMatch(records, /s-coupon\.md.*아직 커밋되지 않음/);
  assert.doesNotMatch(readDraft(projectDir), /s-old/, "base에 이미 있던 공유본을 읽음");

  // base를 주면 그 지점부터 본다: 브랜치 첫 커밋을 base로 주면 커밋하지 않은 공유본만 남는다.
  const sinceShared = prContext(projectDir, ["HEAD"]);
  assert.equal(sinceShared.status, 0, sinceShared.stderr);
  assert.doesNotMatch(section(readDraft(projectDir), "## 기록과 확정 케이스"), /s-coupon/);
});

test("PC2: 초안은 .your-call/pr/<브랜치>.md에 쓰고(/는 -로), 처음 쓸 때 .your-call/pr/.gitignore에 *를 두며 위의 .gitignore는 건드리지 않는다. 다시 부르면 사실 절만 새로 쓰고 작성자 설명 절은 사람이 쓴 그대로 둔다", () => {
  const projectDir = repoOnBranch();

  prContext(projectDir);

  assert.equal(readFileSync(join(projectDir, ".your-call", "pr", ".gitignore"), "utf8"), "*\n");
  assert.equal(readFileSync(join(projectDir, ".your-call", ".gitignore"), "utf8"), "ledger/\n");
  assert.doesNotMatch(git(projectDir, "status", "--porcelain", "--untracked-files=all"), /\.your-call\/pr\//, "초안이 커밋 대상으로 보임");

  const humanAnswer = "쿠폰 만료가 타임존마다 달라지는 버그를 없애려고 서버 시간으로 통일했다.";
  const draft = readDraft(projectDir);
  writeFileSync(join(projectDir, DRAFT), draft.replace("### 무엇을 왜\n", `### 무엇을 왜\n${humanAnswer}\n`));
  appendFileSync(join(projectDir, ".your-call", "shared", "s-coupon.md"), "\n## 9. [2026-10-27 10:09Z] — 원문 공유 안 함\n- 바꾼 파일: src/late.ts\n");

  const again = prContext(projectDir);

  assert.equal(again.status, 0, again.stderr);
  const rewritten = readDraft(projectDir);
  assert.ok(rewritten.includes(humanAnswer), "사람이 쓴 설명이 사라짐");
  assert.match(section(rewritten, "## AI 혼자 판단한 곳"), /9번 턴: src\/late\.ts/, "사실 절이 새로 쓰이지 않음");
});

test("PC3: 본문 순서는 리뷰 순서 안내(diff → 테스트 → 기록) → 작성자 설명 → ⚑ 개입 지점 → 리뷰에서 물을 것 → AI 혼자 판단한 곳 → 기록과 확정 케이스", () => {
  const projectDir = repoOnBranch();

  prContext(projectDir);

  const draft = readDraft(projectDir);
  const order = ["## 리뷰 순서", "## 작성자 설명", "## ⚑ 개입 지점", "## 리뷰에서 물을 것", "## AI 혼자 판단한 곳", "## 기록과 확정 케이스"].map((heading) =>
    draft.indexOf(`\n${heading}\n`),
  );
  assert.ok(order.every((at) => at !== -1), draft);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  const guide = section(draft, "## 리뷰 순서");
  assert.ok(guide.indexOf("diff") < guide.indexOf("테스트") && guide.indexOf("테스트") < guide.indexOf("기록"), guide);
});

test("PC4: 작성자 설명 절에는 네 질문(무엇을 왜 / 장단점 / 중간에 내린 판단 / 자신 없는 곳)만 있고 답은 비어 있다", () => {
  const projectDir = repoOnBranch();

  prContext(projectDir);

  const author = section(readDraft(projectDir), "## 작성자 설명");
  const questions = author.split("\n").filter((line) => line.startsWith("### "));
  assert.deepEqual(questions, ["### 무엇을 왜", "### 장단점", "### 중간에 내린 판단", "### 자신 없는 곳"]);
  const answers = author.split("\n").filter((line) => line.trim() !== "" && !line.startsWith("#") && !line.startsWith("<!--") && !line.startsWith(">"));
  assert.deepEqual(answers, [], `답이 채워져 있음\n${author}`);
});

test("PC5: ⚑ 개입 지점은 공유본마다 선택(질문 제목, 고른 것, 버린 것)과 중단(종류)을 턴 번호와 함께 나열한다", () => {
  const projectDir = repoOnBranch();

  prContext(projectDir);

  const interventions = section(readDraft(projectDir), "## ⚑ 개입 지점");
  assert.match(interventions, /s-coupon/);
  assert.match(interventions, /1번 턴 선택 「기준 시간」 고른 것: 서버 시간 \(Recommended\) · 버린 것: 클라이언트 시간/);
  assert.match(interventions, /1번 턴 ✋ 중단 \(도구 사용 중\)/);
});

test("PC6: 이유가 \"(비어 있음)\"인 선택은 \"리뷰에서 물을 것\"에 \"공유본 N번 턴 「제목」: 고른 것은 ○○ — 이유가 비어 있습니다\"로 나온다", () => {
  const projectDir = repoOnBranch();

  prContext(projectDir);

  const questions = section(readDraft(projectDir), "## 리뷰에서 물을 것");
  assert.match(questions, /s-coupon 1번 턴 「기준 시간」: 고른 것은 서버 시간 \(Recommended\) — 이유가 비어 있습니다/);
});

test("PC7: 바꾼 파일이 있는데 의도도 ⚑도 없는 턴(기계가 넣은 턴 포함)은 \"AI 혼자 판단한 곳\"에 턴 번호, 파일과 함께 나온다", () => {
  const projectDir = repoOnBranch();

  prContext(projectDir);

  const alone = section(readDraft(projectDir), "## AI 혼자 판단한 곳");
  assert.match(alone, /s-coupon 2번 턴: src\/agent-made\.ts/);
  assert.match(alone, /s-coupon 3번 턴: src\/shipping\.ts/);
  assert.doesNotMatch(alone, /1번 턴/, "의도와 선택이 있는 턴을 AI 혼자 판단한 곳으로 셈");
  assert.doesNotMatch(alone, /4번 턴/, "바꾼 파일이 없는 턴을 셈");
});

test("PC8: 공유본에 없는 것은 본문에도 없다 — ledger를 읽지 않으므로 공유하지 않은 원문이나 AI의 말이 섞이지 않는다", () => {
  const projectDir = repoOnBranch();
  assert.ok(readFileSync(join(projectDir, ".your-call", "ledger", "s-coupon.jsonl"), "utf8").includes(PRIVATE_REQUEST), "준비가 틀림");

  prContext(projectDir);

  const draft = readDraft(projectDir);
  assert.ok(!draft.includes(PRIVATE_REQUEST), "공유하지 않은 원문이 들어감");
  assert.ok(!draft.includes(AI_LAST_WORDS), "AI의 말이 들어감");
});

test("PC9: 이 브랜치에서 바뀐 .your-call/spec/*/cases.md의 살아 있는 케이스를 작업별로 나열한다", () => {
  const projectDir = repoOnBranch();
  mkdirSync(join(projectDir, ".your-call", "spec", "coupon-expiry"), { recursive: true });
  writeFileSync(
    join(projectDir, ".your-call", "spec", "coupon-expiry", "cases.md"),
    "- C1: 만료 시각이 지난 쿠폰은 사용할 수 없다\n- C2: ~~만료 판정은 클라이언트 시간 기준이다~~\n- C3: 만료 판정은 서버 시간 기준이다\n",
  );

  prContext(projectDir);

  const records = section(readDraft(projectDir), "## 기록과 확정 케이스");
  assert.match(records, /coupon-expiry/);
  assert.match(records, /C1: 만료 시각이 지난 쿠폰은 사용할 수 없다/);
  assert.match(records, /C3: 만료 판정은 서버 시간 기준이다/);
  assert.doesNotMatch(records, /클라이언트 시간 기준이다/, "취소된 케이스가 나옴");
  assert.doesNotMatch(records, /old-work|지난 작업의 케이스/, "브랜치에서 바뀌지 않은 cases.md가 나옴");
});

test("PC10: 공유본에서 형식을 알아보지 못한 줄이 있으면 추측하지 않고 파일별로 그 수를 드러낸다", () => {
  const projectDir = repoOnBranch();
  appendFileSync(join(projectDir, ".your-call", "shared", "s-coupon.md"), "- 리뷰어 메모: 이 턴 다시 보기\n그냥 적은 줄\n");

  prContext(projectDir);

  const records = section(readDraft(projectDir), "## 기록과 확정 케이스");
  assert.match(records, /s-coupon\.md.*읽지 못한 줄 2개/);
  assert.doesNotMatch(records, /s-draft\.md.*읽지 못한 줄/, "형식대로인 공유본에도 읽지 못한 줄을 셈");
  assert.doesNotMatch(readDraft(projectDir), /리뷰어 메모/, "읽지 못한 줄을 추측해 옮김");
});

test("PC11: git 저장소가 아니거나, base를 찾지 못하거나, 바뀐 공유본이 없으면 파일을 쓰지 않고 그렇다고 말한다. 공유본이 없을 때는 /your-call:share를 먼저 부르라고 안내한다", () => {
  const notRepo = makeProjectDir();
  mkdirSync(join(notRepo, ".your-call"), { recursive: true });
  const outside = prContext(notRepo);
  assert.match(outside.stdout, /git 저장소가 아닙니다/);
  assert.equal(existsSync(join(notRepo, ".your-call", "pr")), false);

  const projectDir = repoOnBranch();
  const unknownBase = prContext(projectDir, ["no-such-branch"]);
  assert.match(unknownBase.stdout, /no-such-branch.*찾지 못했습니다/);
  assert.equal(existsSync(join(projectDir, ".your-call", "pr")), false);

  git(projectDir, "add", "-A");
  git(projectDir, "commit", "-q", "-m", "share draft");
  const nothingShared = prContext(projectDir, ["HEAD"]);
  assert.match(nothingShared.stdout, /바뀐 공유본이 없습니다/);
  assert.match(nothingShared.stdout, /\/your-call:share/);
  assert.equal(existsSync(join(projectDir, ".your-call", "pr")), false);

  // 같은 저장소에서 공유본이 있으면 쓴다: 위의 "쓰지 않음"이 스크립트가 아예 실패해서가 아님을 보인다.
  assert.equal(prContext(projectDir).status, 0);
  assert.equal(existsSync(join(projectDir, DRAFT)), true);
});

test("PC2-a: 초안 파일은 있는데 작성자 설명 절의 표시를 찾지 못하면 덮어쓰지 않고 알린다", () => {
  const projectDir = repoOnBranch();
  prContext(projectDir);
  const humanEdited = readDraft(projectDir).replace("<!-- your-call:author-start -->\n", "").replace("### 무엇을 왜\n", "### 무엇을 왜\n표시를 지운 채 쓴 설명\n");
  writeFileSync(join(projectDir, DRAFT), humanEdited);

  const again = prContext(projectDir);

  assert.match(again.stdout, /작성자 설명 절의 표시를 찾지 못해 덮어쓰지 않았습니다/);
  assert.equal(readDraft(projectDir), humanEdited);
});

test("PC11-a: detached HEAD이면 브랜치를 알 수 없다고 말하고 파일을 쓰지 않는다", () => {
  const projectDir = repoOnBranch();
  git(projectDir, "checkout", "-q", "--detach");

  const run = prContext(projectDir);

  assert.match(run.stdout, /브랜치를 알 수 없습니다/);
  assert.equal(existsSync(join(projectDir, ".your-call", "pr")), false);
  // 같은 저장소에서 브랜치로 돌아오면 쓴다: 위의 "쓰지 않음"이 다른 이유로 실패해서가 아님을 보인다.
  git(projectDir, "checkout", "-q", BRANCH);
  prContext(projectDir);
  assert.equal(existsSync(join(projectDir, DRAFT)), true);
});

test("PC14: origin이 GitHub이면 공유본 링크를 https://github.com/<owner>/<repo>/blob/<브랜치>/… 로 쓰고, 아니면 경로만 쓴다", () => {
  const projectDir = repoOnBranch();

  prContext(projectDir);
  const plain = section(readDraft(projectDir), "## 기록과 확정 케이스");
  assert.match(plain, /`\.your-call\/shared\/s-coupon\.md`/);
  assert.doesNotMatch(plain, /https:\/\//);

  git(projectDir, "remote", "add", "origin", "git@github.com:acme/shop.git");
  prContext(projectDir);
  const linked = section(readDraft(projectDir), "## 기록과 확정 케이스");
  assert.ok(linked.includes("(https://github.com/acme/shop/blob/feature/coupon/.your-call/shared/s-coupon.md)"), linked);
});
