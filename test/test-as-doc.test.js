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

const agent = parts(join(pluginDir, "agents", "test-as-doc.md"));
const skill = parts(join(pluginDir, "skills", "testdoc", "SKILL.md"));

/** 본문에서 "## 제목"부터 다음 "## " 전까지. 반환 형식은 예시 코드 블록에 "## "가 있어 끝까지 읽는다. */
const section = (/** @type {string} */ title) => {
  const start = agent.body.indexOf(`## ${title}`);
  assert.notEqual(start, -1, title);
  if (title === "반환 형식") return agent.body.slice(start);
  const next = agent.body.indexOf("\n## ", start + 1);
  return agent.body.slice(start, next === -1 ? undefined : next);
};

test("TD1: 에이전트 정의에 입력(테스트 파일), 경계, 반환 형식이 있고 tools는 Read, Grep, Glob뿐이다", () => {
  assert.match(agent.frontmatter, /^name: test-as-doc$/m);
  assert.deepEqual((agent.frontmatter.match(/^tools: (.*)$/m)?.[1] ?? "").split(/,\s*/).sort(), ["Glob", "Grep", "Read"]);
  assert.match(section("입력"), /테스트 파일/);
  section("경계");
  section("반환 형식");
});

test("TD2: 경계 — 실행하지 않고, 고치거나 다시 쓰지 않고, 케이스 짝을 보지 않고, 로직을 판정하지 않고, 사람에게 묻지 않는다", () => {
  const boundary = section("경계");
  for (const rule of [/실행하지 않/, /고치거나 다시 쓰지 않/, /짝.*보지 않/, /로직.*판정하지 않/, /사람에게 묻지 않/]) assert.match(boundary, rule);
});

test("TD3: 세 기준을 정의에 못 박는다 — 이름은 조건과 기대, 준비는 도메인 어휘, 단언의 숫자는 의미가 드러나야 하고 0과 1은 예외", () => {
  const rules = section("기준");
  assert.match(rules, /조건과 기대/);
  assert.match(rules, /이름 붙지 않은 리터럴/);
  assert.match(rules, /도메인 어휘/);
  assert.match(rules, /설명 없는 숫자/);
  assert.match(rules, /0과 1/);
});

test("TD4: 반환 형식은 찾아본 것(상대 경로), 테스트별 세 기준과 근거(파일:줄, 인용), 반복되는 흔적, 사람에게 물을 것을 담고 '문제없음'만은 위반이다", () => {
  const format = section("반환 형식");
  for (const part of ["찾아본 것", "상대 경로", "파일:줄", "인용", "반복되는 흔적", "사람에게 물을 것", "문제없음"]) assert.match(format, new RegExp(part), part);
});

test("TD5: /your-call:testdoc은 사람만 부르고, 에이전트에 넘기고, 결과를 그대로 보여 주고, 물을 것만 묻고, 테스트를 고치지 않는다", () => {
  assert.match(skill.frontmatter, /^disable-model-invocation: true$/m);
  assert.match(skill.frontmatter, /^argument-hint: .*<테스트 파일/m);
  assert.match(skill.body, /your-call:test-as-doc/);
  assert.match(skill.body, /고치거나 요약하지 않/);
  assert.match(skill.body, /사람에게 물을 것/);
  assert.match(skill.body, /테스트.*고치지 않/);
});
