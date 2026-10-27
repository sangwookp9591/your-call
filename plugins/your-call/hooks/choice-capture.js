// serves: P2, P10 — 사람이 선택지에서 고른 순간을 사실로만 남긴다: 제시된 것, 고른 것, 버린 것, AI의 추천.
// 고른 것은 의도가 아니다. 이유 칸(reason)은 비워 두고, AI가 짐작해 채울 칸을 만들지 않는다.

import { capture } from "../lib/capture.js";

const RECOMMENDED = /\(Recommended\)\s*$/;

/**
 * 답 문자열을 선택지 이름과 맞춰 나눈다. 여러 개 고른 답은 ", "로 이어져 오고, 이름 자체에도 쉼표가 있을 수 있다.
 * 이름과 맞지 않고 남은 부분은 사람이 직접 쓴 답이다.
 * @param {string} answer
 * @param {string[]} labels
 * @returns {{ chosen: string[], otherText: string | null }}
 */
function splitAnswer(answer, labels) {
  let rest = `, ${answer}, `;
  const picked = new Set();
  for (const label of [...labels].sort((a, b) => b.length - a.length)) {
    if (rest.includes(`, ${label}, `)) {
      picked.add(label);
      rest = rest.replace(`, ${label}, `, ", ");
    }
  }
  const leftover = rest.slice(2, -2);
  return { chosen: labels.filter((label) => picked.has(label)), otherText: leftover === "" ? null : leftover };
}

await capture((input) => {
  if (input.tool_name !== "AskUserQuestion") return null;
  const questions = /** @type {any} */ (input.tool_input)?.questions;
  const response = /** @type {any} */ (input.tool_response);
  const answers = response?.answers;
  if (!Array.isArray(questions) || answers === null || typeof answers !== "object") return null;

  const entries = [];
  for (const asked of questions) {
    const answer = answers[asked?.question];
    const options = asked?.options;
    if (typeof answer !== "string" || !Array.isArray(options)) continue;
    if (!options.every((option) => typeof option?.label === "string")) continue;

    /** @type {string[]} */
    const labels = options.map((option) => option.label);
    const { chosen, otherText } = splitAnswer(answer, labels);
    const notes = response.annotations?.[asked.question]?.notes;
    entries.push({
      event: "choice",
      by: "choice-capture",
      tool_use_id: input.tool_use_id ?? null,
      question: asked.question,
      header: typeof asked.header === "string" ? asked.header : null,
      multi_select: asked.multiSelect === true,
      offered: options.map((option) => ({
        label: option.label,
        description: typeof option.description === "string" ? option.description : null,
      })),
      recommended: labels.filter((label) => RECOMMENDED.test(label)),
      chosen,
      rejected: labels.filter((label) => !chosen.includes(label)),
      other_text: otherText,
      notes: typeof notes === "string" ? notes : null,
      reason: null,
      intervention: true,
    });
  }
  return entries;
});
