import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendCases, casesPath } from "../plugins/your-call/lib/spec.js";
import { makeProjectDir, pluginDir } from "./helpers.js";

/**
 * 스킬 본문의 !`node …/spec-state.js $ARGUMENTS` 와 같은 방식으로 상태 스크립트를 돌린다.
 * @param {string} cwd Bash가 있는 폴더
 * @param {string[]} args
 */
const state = (cwd, args) => spawnSync(process.execPath, [join(pluginDir, "scripts", "spec-state.js"), ...args], { cwd, encoding: "utf8" });

/** 기록 폴더가 있는 프로젝트 (플러그인이 켜진 세션이면 SessionStart가 만든다) */
function project() {
  const projectDir = makeProjectDir();
  mkdirSync(join(projectDir, ".your-call", "ledger"), { recursive: true });
  mkdirSync(join(projectDir, "src"));
  return projectDir;
}

const [, frontmatter = "", body = ""] = readFileSync(join(pluginDir, "skills", "spec", "SKILL.md"), "utf8").match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];

test("SK1: 사람만 부를 수 있고, 미리 허용하는 도구는 node 상태 스크립트, 읽기 도구, proposals.md 쓰기뿐이다", () => {
  assert.match(frontmatter, /^disable-model-invocation: true$/m);
  const allowed = (frontmatter.match(/^allowed-tools: (.*)$/m)?.[1] ?? "").split(/,\s*/);
  assert.deepEqual(allowed.sort(), ["Bash(node:*)", "Edit(.your-call/spec/**/proposals.md)", "Glob", "Grep", "Read"].sort());
  assert.match(body, /spec-state\.js" \$ARGUMENTS/);
});

test("SK2: 작업 이름이 없거나 규칙 밖이면 그렇다고 말하고 이름 규칙을 알려 준 뒤 다른 내용은 보여 주지 않는다", () => {
  const projectDir = project();
  appendCases(projectDir, "coupon-expiry", ["가"]);

  for (const args of [[], ["쿠폰 만료"], ["../ledger"]]) {
    const run = state(projectDir, args);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /작업 이름/);
    assert.match(run.stdout, /영문, 숫자, _, -/);
    assert.doesNotMatch(run.stdout, /확정 케이스/);
  }

  // 같은 틀에서 이름이 맞으면 상태가 나온다: 위의 안내가 스크립트가 돌지 않아서가 아님을 보인다.
  assert.match(state(projectDir, ["coupon-expiry"]).stdout, /C1: 가/);
});

test("SK3: 이름이 맞으면 cases.md 경로, 확정 케이스(파일 순서, 취소선 제외), proposals.md의 이전 검토 제목을 보여 주고, 없으면 없다고 말한다", () => {
  const projectDir = project();

  const empty = state(join(projectDir, "src"), ["coupon-expiry", "쿠폰", "만료"]).stdout;
  assert.match(empty, /\.your-call\/spec\/coupon-expiry\/cases\.md/);
  assert.match(empty, /아직 확정된 케이스가 없습니다/);
  assert.match(empty, /아직 검토 기록이 없습니다/);

  appendCases(projectDir, "coupon-expiry", ["가", "나", "다"]);
  const path = casesPath(projectDir, "coupon-expiry") ?? "";
  writeFileSync(path, readFileSync(path, "utf8").replace("- C2: 나", "- C2: ~~나~~"));
  writeFileSync(join(projectDir, ".your-call", "spec", "coupon-expiry", "proposals.md"), "# coupon-expiry 제안\n\n## 2026-10-28 검토\n\n- 빠진 케이스 …\n\n## 2026-10-29 검토\n\n- 모호한 조건 …\n");

  const filled = state(projectDir, ["coupon-expiry"]).stdout;
  assert.match(filled, /- C1: 가\n- C3: 다\n/);
  assert.doesNotMatch(filled, /C2/);
  assert.match(filled, /- 2026-10-28 검토\n- 2026-10-29 검토/);
});

test("SK4: 프로젝트 폴더(.your-call)를 찾지 못하면 추측하지 않고 그렇다고 말한다", () => {
  const run = state(makeProjectDir(), ["coupon-expiry"]);

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /프로젝트 폴더/);
  assert.match(run.stdout, /찾지 못했습니다/);
  // 같은 틀에서 프로젝트가 있으면 상태가 나온다.
  assert.match(state(project(), ["coupon-expiry"]).stdout, /아직 확정된 케이스가 없습니다/);
});

test("SK5: 본문이 절차를 담는다 — 묻고 지어내지 않기, 날짜별 검토 섹션과 근거, 확정 질문 형식(추천 표시 없음), cases.md 쓰지 않기, 확정 뒤 멈추기", () => {
  // ① 이름이나 무엇을/왜가 없으면 사람에게 묻고 멈춘다
  assert.match(body, /무엇을, 왜/);
  assert.match(body, /지어내지 않/);
  // ② 날짜별 검토 섹션, 항목의 종류·제안 문장·근거, "문제없음"만 쓰지 않음
  assert.match(body, /## <날짜> 검토/);
  for (const kind of ["케이스 초안", "빠진 케이스", "모호한 조건", "숨은 전제", "기존 동작과 어긋남"]) assert.match(body, new RegExp(kind));
  assert.match(body, /찾아본 것과 근거/);
  assert.match(body, /문제없음/);
  // ③ 확정 질문 형식
  assert.match(body, /header.*케이스 확정/);
  assert.match(body, /\[<작업>\]/);
  assert.match(body, /label.*제안 문장 그대로/);
  assert.match(body, /4개/);
  assert.match(body, /Other/);
  assert.match(body, /추천 표시는 붙이지 않는다/);
  // ④ cases.md를 쓰지 않는다, ⑤ 확정 뒤 멈추고 테스트를 쓰지 않는다
  assert.match(body, /cases\.md.*쓰지 않/);
  assert.match(body, /테스트.*쓰지 않/);
});
