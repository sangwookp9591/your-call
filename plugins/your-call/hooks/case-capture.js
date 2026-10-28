// serves: P14 — 사람이 확정 질문에서 고르거나 직접 쓴 문장만 cases.md에 옮긴다. 확정 케이스가 들어오는 유일한 길이다.
// 확정 질문 = header가 "케이스 확정"이고 question이 "[<작업>]"로 시작하는 AskUserQuestion 질문.
// 고른 선택지는 label 그대로(사람이 누른 글자 = 기록되는 글자), 직접 쓴 답은 줄마다 케이스 하나.
// 결과는 AI가 테스트 이름에 쓸 수 있게 additionalContext 한 덩어리로만 알린다 (P6).

import { splitAnswer } from "../lib/answer.js";
import { readHookInput } from "../lib/hook-input.js";
import { appendCases, casesPath, readCases } from "../lib/spec.js";

const HEADER = "케이스 확정";
const WORK = /^\s*\[([^\]]*)\]/;
const RECOMMENDED = /\s*\(Recommended\)\s*$/;

const input = await readHookInput();
const projectDir = process.env.CLAUDE_PROJECT_DIR;

if (input.ok && projectDir && input.value.tool_name === "AskUserQuestion") {
  const questions = /** @type {any} */ (input.value.tool_input)?.questions;
  const answers = /** @type {any} */ (input.value.tool_response)?.answers ?? {};
  const notes = [];

  for (const asked of Array.isArray(questions) ? questions : []) {
    const work = asked?.header === HEADER && typeof asked?.question === "string" ? WORK.exec(asked.question)?.[1] : undefined;
    if (work === undefined) continue;

    if (casesPath(projectDir, work) === null) {
      notes.push(`your-call: [${work}] 작업 이름에는 영문, 숫자, _, -만 쓸 수 있어 cases.md에 옮기지 않았습니다.`);
      continue;
    }
    /** @type {string[]} */
    const labels = (Array.isArray(asked.options) ? asked.options : []).map((/** @type {any} */ option) => option?.label).filter((/** @type {unknown} */ label) => typeof label === "string");
    const { chosen, otherText } = splitAnswer(typeof answers[asked.question] === "string" ? answers[asked.question] : "", labels);
    const texts = [...chosen.map((label) => label.replace(RECOMMENDED, "")), ...(otherText ?? "").split(/\r?\n/)];

    const before = new Set(readCases(projectDir, work).map((c) => c.id));
    const added = appendCases(projectDir, work, texts);
    if (added.length === 0) {
      notes.push(`your-call: [${work}] 고른 케이스가 없어 cases.md에 옮기지 않았습니다.`);
      continue;
    }
    const lines = added.map((c) => `- ${c.id}: ${c.text}${before.has(c.id) ? " (이미 있던 케이스)" : ""}`);
    notes.push(`your-call: [${work}] 사람이 확정한 케이스 → .your-call/spec/${work}/cases.md\n${lines.join("\n")}`);
  }

  if (notes.length > 0) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: notes.join("\n") } }));
  }
}
