import { test } from "node:test";
import assert from "node:assert/strict";
import { splitAnswer } from "../plugins/your-call/lib/answer.js";
import { readCases } from "../plugins/your-call/lib/spec.js";
import { makeProjectDir, readLedger, runHook } from "./helpers.js";

// 2026-10-28 CC8 수동 확인에서 실제 multiSelect 질문에 들어온 답 그대로 (Claude Code 2.1.311).
// 사람이 Other에 입력한 원문은  `  "만료 판정은 서버 시간 기준이다" ` 이고, Claude Code가 이것을 JSON 문자열로 감싸 보냈다.
const LABELS = ["만료 시각이 지난 쿠폰은 사용할 수 없다", "만료 시각과 같은 순간은 사용할 수 있다"];
const REAL_ANSWER = '만료 시각이 지난 쿠폰은 사용할 수 없다, "  \\"만료 판정은 서버 시간 기준이다\\" "';
const TYPED = '  "만료 판정은 서버 시간 기준이다" ';

test("AN1: 직접 쓴 답이 JSON 문자열로 감싸여 오면 풀어서 사람이 입력한 원문으로 돌려주고, choice-capture와 case-capture 모두 그 원문을 쓴다", () => {
  assert.deepEqual(splitAnswer(REAL_ANSWER, LABELS), { chosen: [LABELS[0]], otherText: TYPED });
  // 감싸지 않은 답(single-select에서 본 모양)은 지금처럼 그대로 둔다.
  assert.deepEqual(splitAnswer("직접 쓴 답", LABELS), { chosen: [], otherText: "직접 쓴 답" });
  // 따옴표로 시작하고 끝나도 JSON 문자열이 아니면 원문 그대로다.
  assert.deepEqual(splitAnswer('"서버" 시간과 "클라이언트"', LABELS), { chosen: [], otherText: '"서버" 시간과 "클라이언트"' });

  const projectDir = makeProjectDir();
  const questions = [{ question: "[coupon-expiry] 확정할 케이스를 고르세요", header: "케이스 확정", multiSelect: true, options: LABELS.map((label) => ({ label, description: "근거" })) }];
  const stdin = JSON.stringify({ session_id: "s-an", prompt_id: "p-an", hook_event_name: "PostToolUse", tool_name: "AskUserQuestion", tool_use_id: "toolu_an", tool_input: { questions }, tool_response: { questions, answers: { [questions[0].question]: REAL_ANSWER }, annotations: {} } });
  for (const hook of ["choice-capture", "case-capture"]) assert.equal(runHook(hook, { stdin, projectDir }).status, 0, hook);

  const [choice] = readLedger(projectDir, "s-an").filter((line) => line.event === "choice");
  assert.equal(choice.other_text, TYPED);
  assert.deepEqual(readCases(projectDir, "coupon-expiry"), [
    { id: "C1", text: LABELS[0] },
    { id: "C2", text: '"만료 판정은 서버 시간 기준이다"' },
  ]);
});
