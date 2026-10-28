// serves: P14, P11 — 확정 케이스의 계약. cases.md의 "- C<n>: 문장" 한 줄 = 사람이 확정한 케이스 하나.
// 번호는 이 계약이 매기고, 문장은 받은 그대로 둔다. 따로 둔 상태 없이 파일이 유일한 기준이라,
// 사람이 편집기로 고치거나 지운 것도 그대로 따른다. 스펙은 커밋되어 팀과 함께 보므로 .gitignore는 건드리지 않는다.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** 경로로 써도 spec 폴더를 벗어날 수 없는 작업 이름만 받는다. */
const SAFE_WORK = /^[A-Za-z0-9_-]+$/;
const CASE_LINE = /^- C(\d+): (.*)$/;
/** 사람이 케이스를 지울 때 줄 대신 문장에 긋는 취소선. 번호는 남겨서 다시 쓰이지 않게 한다. */
const STRUCK = /^~~.*~~$/;
const OWNERSHIP_NOTE = "<!-- 사람이 확정한 케이스만 둡니다. AI는 이 파일을 쓸 수 없습니다. -->";

/**
 * @param {string} projectDir
 * @param {string} work 작업 이름. 사람이 /spec에 준 것
 * @returns {string | null} 작업 이름이 안전하지 않으면 null
 */
export function casesPath(projectDir, work) {
  if (!SAFE_WORK.test(work)) return null;
  return join(projectDir, ".your-call", "spec", work, "cases.md");
}

/**
 * 취소선 줄까지 포함한 모든 케이스 줄. 번호 계산에는 취소된 번호도 들어가야 한다.
 * @param {string} path
 * @returns {Array<{ number: number, text: string }>}
 */
function caseLines(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return text.split("\n").flatMap((line) => {
    const match = CASE_LINE.exec(line.trimEnd());
    return match ? [{ number: Number(match[1]), text: match[2] }] : [];
  });
}

/**
 * @param {string} projectDir
 * @param {string} work
 * @returns {Array<{ id: string, text: string }>} 살아 있는 케이스를 파일 순서대로. 파일이 없으면 빈 배열
 */
export function readCases(projectDir, work) {
  const path = casesPath(projectDir, work);
  if (!path) return [];
  return caseLines(path)
    .filter((line) => !STRUCK.test(line.text))
    .map((line) => ({ id: `C${line.number}`, text: line.text }));
}

/**
 * 확정된 문장들을 덧붙인다. 이미 살아 있는 케이스와 같은 문장은 새 번호를 받지 않는다.
 * @param {string} projectDir
 * @param {string} work
 * @param {string[]} texts 사람이 고르거나 쓴 문장
 * @returns {Array<{ id: string, text: string }>} 받은 순서대로, 각 문장이 가진 번호. 빈 문장은 빠진다
 */
export function appendCases(projectDir, work, texts) {
  const path = casesPath(projectDir, work);
  if (!path) return [];

  const existing = caseLines(path);
  const live = new Map(existing.filter((line) => !STRUCK.test(line.text)).map((line) => [line.text, `C${line.number}`]));
  let next = Math.max(0, ...existing.map((line) => line.number)) + 1;

  const result = [];
  const newLines = [];
  for (const raw of texts) {
    const text = raw.replace(/\s*[\r\n]\s*/g, " ").trim();
    if (text === "") continue;
    let id = live.get(text);
    if (id === undefined) {
      id = `C${next++}`;
      live.set(text, id);
      newLines.push(`- ${id}: ${text}\n`);
    }
    result.push({ id, text });
  }
  if (newLines.length === 0) return result;

  mkdirSync(dirname(path), { recursive: true });
  // 동시에 도는 hook이 줄을 섞지 않게 append 한 번으로 쓴다. 사람이 마지막 줄바꿈 없이 저장했으면 그 줄에 이어 붙이지 않는다.
  const before = existsSync(path) ? (readFileSync(path, "utf8").match(/[^\n]$/) ? "\n" : "") : `# ${work}\n\n${OWNERSHIP_NOTE}\n\n`;
  appendFileSync(path, before + newLines.join(""));
  return result;
}
