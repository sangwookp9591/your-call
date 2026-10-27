// serves: P3 — 사람이 먼저 밝힌 의도만 의도 칸에 옮긴다. 첫머리의 `why:`부터 첫 빈 줄 전까지.
// 기계가 넣은 입력(system, loop_wakeup 등)은 사람의 말이 아니므로 인정하지 않는다.

import { capture } from "../lib/capture.js";

/** source 필드는 아직 배포 중이라 값이 없을 수 있다. 값이 없으면 사람이 넣은 입력으로 본다. */
/** @type {unknown[]} */
const HUMAN_SOURCES = [null, "user", "sdk"];
const WHY_AT_START = /^\s*why:/i;
const BLANK_LINE = /\r?\n[ \t]*\r?\n/;

/**
 * @param {string} prompt
 * @returns {string} 밝힌 의도. 없으면 빈 문자열.
 */
function statedIntent(prompt) {
  const why = prompt.match(WHY_AT_START);
  if (!why) return "";
  return prompt.slice(why[0].length).split(BLANK_LINE)[0].trim();
}

await capture((input) => {
  const source = input.source ?? null;
  if (typeof input.prompt !== "string" || !HUMAN_SOURCES.includes(source)) return null;

  const intent = statedIntent(input.prompt);
  if (intent === "") return null;
  return { event: "intent", by: "intent-capture", prompt_id: input.prompt_id ?? null, source, text: intent };
});
