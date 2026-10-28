import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pluginDir } from "./helpers.js";

/** @param {string} path */
function parts(path) {
  const [, frontmatter = "", body = ""] = readFileSync(path, "utf8").match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
  return { frontmatter, body };
}

const agent = parts(join(pluginDir, "agents", "case-coverage.md"));
const skill = parts(join(pluginDir, "skills", "coverage", "SKILL.md"));

/** 본문에서 "## 제목" 섹션 하나 */
const section = (/** @type {string} */ body, /** @type {string} */ title) => body.split(/^## /m).find((part) => part.startsWith(title)) ?? "";

test("CV1: 에이전트 정의에 입력, 경계, 반환 형식 세 항목이 있고 tools는 Read, Grep, Glob뿐이다", () => {
  assert.match(agent.frontmatter, /^name: case-coverage$/m);
  assert.deepEqual((agent.frontmatter.match(/^tools: (.*)$/m)?.[1] ?? "").split(/,\s*/).sort(), ["Glob", "Grep", "Read"]);
  for (const title of ["입력", "경계", "반환 형식"]) assert.notEqual(section(agent.body, title), "", title);
  // 입력: 작업 이름, cases.md, 테스트 파일 (없으면 'C<n>:' 이름을 찾아보고 어디를 봤는지 적는다)
  const input = section(agent.body, "입력");
  assert.match(input, /작업 이름/);
  assert.match(input, /cases\.md/);
  assert.match(input, /테스트 파일/);
  assert.match(input, /C<n>:/);
});

test("CV2: 경계 — 테스트를 실행하지 않고, 고치지 않고, 새 케이스를 제안하지 않고, 품질을 판정하지 않고, 사람에게 묻지 않는다", () => {
  const boundary = section(agent.body, "경계");
  for (const rule of [/실행하지 않/, /고치지 않/, /새 케이스를 제안하지 않/, /품질.*판정하지 않/, /사람에게 묻지 않/]) assert.match(boundary, rule);
});

test("CV3: 반환 형식은 찾아본 것(상대 경로), 케이스마다 네 가지 상태와 근거(파일:줄), 케이스에 없는 테스트, 사람에게 물을 것을 담고 '문제없음'만은 위반이다", () => {
  // 반환 형식은 마지막 섹션이고, 예시 코드 블록 안에도 "## " 줄이 있어 끝까지 읽는다.
  const format = agent.body.slice(agent.body.indexOf("## 반환 형식"));
  assert.notEqual(agent.body.indexOf("## 반환 형식"), -1);
  assert.match(format, /찾아본 것/);
  assert.match(format, /상대 경로/);
  for (const status of ["짝 있음", "짝 없음", "단언이 다름", "문장이 다름"]) assert.match(format, new RegExp(status));
  assert.match(format, /파일:줄/);
  assert.match(format, /케이스에 없는 테스트/);
  assert.match(format, /취소된 케이스/);
  assert.match(format, /사람에게 물을 것/);
  assert.match(format, /문제없음/);
});

test("CV5: /your-call:coverage는 사람만 부르고, 확정 케이스를 보여 준 뒤 에이전트에 넘기고, 결과를 그대로 보여 주고, 물을 것만 묻고, 테스트는 쓰지 않는다", () => {
  assert.match(skill.frontmatter, /^disable-model-invocation: true$/m);
  assert.match(skill.frontmatter, /^argument-hint: .*<작업 이름>/m);
  assert.match(skill.body, /spec-state\.js" \$ARGUMENTS/);
  assert.match(skill.body, /your-call:case-coverage/);
  assert.match(skill.body, /고치거나 요약하지 않/);
  assert.match(skill.body, /사람에게 물을 것/);
  assert.match(skill.body, /테스트.*쓰지 않/);
});
