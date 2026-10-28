// serves: P2, P14 — AskUserQuestion의 답을 고른 선택지와 사람이 직접 쓴 답으로 나눈다.
// choice-capture(선택 기록)와 case-capture(확정 케이스)가 같은 답을 같은 규칙으로 나누게 한 곳에 둔다.

/**
 * 답 문자열을 선택지 이름과 맞춰 나눈다. 여러 개 고른 답은 ", "로 이어져 오고, 이름 자체에도 쉼표가 있을 수 있다.
 * 이름과 맞지 않고 남은 부분은 사람이 직접 쓴 답이다.
 * @param {string} answer
 * @param {string[]} labels
 * @returns {{ chosen: string[], otherText: string | null }}
 */
export function splitAnswer(answer, labels) {
  let rest = `, ${answer}, `;
  const picked = new Set();
  for (const label of [...labels].sort((a, b) => b.length - a.length)) {
    if (rest.includes(`, ${label}, `)) {
      picked.add(label);
      rest = rest.replace(`, ${label}, `, ", ");
    }
  }
  const leftover = rest.slice(2, -2);
  return { chosen: labels.filter((label) => picked.has(label)), otherText: leftover === "" ? null : unwrap(leftover) };
}

/**
 * multiSelect 질문에서는 직접 쓴 답이 JSON 문자열로 감싸여 온다 (Claude Code 2.1.311에서 확인).
 * JSON 문자열일 때만 풀고, 그 밖에는 받은 그대로 둔다.
 * @param {string} text
 */
function unwrap(text) {
  if (!(text.startsWith('"') && text.endsWith('"'))) return text;
  try {
    const decoded = JSON.parse(text);
    return typeof decoded === "string" ? decoded : text;
  } catch {
    return text;
  }
}
