import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { appendCases, readCases } from "../plugins/your-call/lib/spec.js";
import { makeProjectDir, runHook } from "./helpers.js";

/**
 * @typedef {{ question: string, header: string, labels: string[], answer?: string }} Asked
 * @param {string | undefined} projectDir
 * @param {Asked[]} asked 사람이 받은 질문과 답
 */
function answer(projectDir, asked) {
  const questions = asked.map((q) => ({ question: q.question, header: q.header, multiSelect: true, options: q.labels.map((label) => ({ label, description: "근거: 제안 이유" })) }));
  /** @type {Record<string, string>} */
  const answers = {};
  for (const q of asked) if (q.answer !== undefined) answers[q.question] = q.answer;
  const stdin = JSON.stringify({ session_id: "s-cc", prompt_id: "p-cc", hook_event_name: "PostToolUse", tool_name: "AskUserQuestion", tool_use_id: "toolu_cc", tool_input: { questions }, tool_response: { questions, answers } });
  return runHook("case-capture", { stdin, projectDir });
}

/** @param {ReturnType<typeof answer>} run */
const contextOf = (run) => (run.stdout === "" ? null : JSON.parse(run.stdout).hookSpecificOutput);

/** @param {string} work @param {string[]} labels @param {string} answerText @returns {Asked} */
const confirm = (work, labels, answerText) => ({ question: `[${work}] 확정할 케이스를 고르세요`, header: "케이스 확정", labels, answer: answerText });

test("CC1: header가 '케이스 확정'이고 question이 '[<작업>]'로 시작하는 질문만 확정으로 보고, 다른 질문에는 아무것도 쓰지 않는다", () => {
  const projectDir = makeProjectDir();

  const run = answer(projectDir, [
    { question: "[coupon-expiry] 어느 쪽으로 할까요?", header: "범위", labels: ["가", "나"], answer: "가" },
    { question: "확정할 케이스를 고르세요", header: "케이스 확정", labels: ["다"], answer: "다" },
    confirm("coupon-expiry", ["만료 시각이 지난 쿠폰은 사용할 수 없다"], "만료 시각이 지난 쿠폰은 사용할 수 없다"),
  ]);

  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(readCases(projectDir, "coupon-expiry"), [{ id: "C1", text: "만료 시각이 지난 쿠폰은 사용할 수 없다" }]);

  // 확정 질문이 없으면 파일도 출력도 없다. 같은 틀에서 위의 확정은 쓰였으므로 hook이 돌지 않아서가 아니다.
  const other = makeProjectDir();
  const quiet = answer(other, [{ question: "[coupon-expiry] 어느 쪽으로 할까요?", header: "범위", labels: ["가"], answer: "가" }]);
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(quiet.stdout, "");
  assert.equal(existsSync(join(other, ".your-call", "spec")), false);
});

test("CC2: 고른 선택지의 label을 선택지 순서대로 덧붙이고, 끝의 (Recommended)는 떼고, 고르지 않은 것은 쓰지 않는다", () => {
  const projectDir = makeProjectDir();

  answer(projectDir, [confirm("w", ["가는 된다 (Recommended)", "나는 안 된다", "다는 경계값이다"], "다는 경계값이다, 가는 된다 (Recommended)")]);

  assert.deepEqual(readCases(projectDir, "w"), [
    { id: "C1", text: "가는 된다" },
    { id: "C2", text: "다는 경계값이다" },
  ]);
});

test("CC3: Other에 직접 쓴 답은 원문 그대로, 줄마다 케이스 하나가 되고, 고른 것과는 choice-capture와 같은 규칙으로 나눈다", () => {
  const projectDir = makeProjectDir();

  answer(projectDir, [confirm("w", ["가, 그리고 나", "다"], "가, 그리고 나, 직접 쓴 첫 케이스\n\n  직접 쓴 둘째 케이스  ")]);

  assert.deepEqual(readCases(projectDir, "w"), [
    { id: "C1", text: "가, 그리고 나" },
    { id: "C2", text: "직접 쓴 첫 케이스" },
    { id: "C3", text: "직접 쓴 둘째 케이스" },
  ]);
});

test("CC4: 한 번의 AskUserQuestion에 확정 질문이 여러 개면 각각의 작업 파일에 덧붙인다", () => {
  const projectDir = makeProjectDir();

  answer(projectDir, [confirm("coupon-expiry", ["가"], "가"), confirm("point-refund", ["나", "다"], "나, 다")]);

  assert.deepEqual(readCases(projectDir, "coupon-expiry").map((c) => c.text), ["가"]);
  assert.deepEqual(readCases(projectDir, "point-refund").map((c) => c.text), ["나", "다"]);
});

test("CC5: 작업 이름이 규칙 밖이거나, 고른 것도 쓴 것도 없으면 쓰지 않는다", () => {
  const projectDir = makeProjectDir();

  for (const asked of [confirm("쿠폰 만료", ["가"], "가"), confirm("w", ["가"], ""), { ...confirm("w", ["가"], ""), answer: undefined }]) {
    const run = answer(projectDir, [asked]);
    assert.equal(run.status, 0, run.stderr);
  }
  assert.equal(existsSync(join(projectDir, ".your-call", "spec")), false);

  // 같은 틀에서 고른 것이 있으면 쓴다: 위의 결과가 hook이 돌지 않아서가 아님을 보인다.
  answer(projectDir, [confirm("w", ["가"], "가")]);
  assert.equal(readCases(projectDir, "w").length, 1);
});

test("CC6: 덧붙인 결과(번호와 문장, 이미 있던 것은 기존 번호)를 additionalContext로 알리고, 쓰지 않았으면 그 이유를 알린다", () => {
  const projectDir = makeProjectDir();
  appendCases(projectDir, "w", ["가"]);

  const written = contextOf(answer(projectDir, [confirm("w", ["가", "나"], "가, 나")]));
  assert.equal(written.hookEventName, "PostToolUse");
  assert.match(written.additionalContext, /\.your-call\/spec\/w\/cases\.md/);
  assert.match(written.additionalContext, /C1: 가 \(이미 있던 케이스\)/);
  assert.match(written.additionalContext, /C2: 나$/m);

  assert.match(contextOf(answer(projectDir, [confirm("쿠폰 만료", ["가"], "가")])).additionalContext, /작업 이름/);
  assert.match(contextOf(answer(projectDir, [confirm("w", ["가"], "")])).additionalContext, /고른 케이스가 없어/);
});

test("CC7: 입력이나 프로젝트 폴더가 없으면 아무것도 하지 않고 통과시킨다", () => {
  const projectDir = makeProjectDir();

  assert.equal(runHook("case-capture", { stdin: "{깨진 입력", projectDir }).status, 0);
  const noProject = answer(undefined, [confirm("w", ["가"], "가")]);
  assert.equal(noProject.status, 0, noProject.stderr);
  assert.equal(noProject.stdout, "");
  assert.equal(existsSync(join(projectDir, ".your-call")), false);

  // 같은 틀에서 재료가 있으면 쓴다.
  answer(projectDir, [confirm("w", ["가"], "가")]);
  assert.equal(readCases(projectDir, "w").length, 1);
});
