// serves: P1, P11 — 모든 hook이 따르는 기록 계약. 이벤트 하나 = JSONL 한 줄 덧붙이기.
// 같은 이벤트에 걸린 hook들은 동시에 돌기 때문에, 한 줄을 한 번의 append로 쓴다.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const FORMAT_VERSION = 1;

/** 파일 이름으로 써도 기록 폴더를 벗어날 수 없는 session_id만 받는다. */
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]+$/;

/**
 * @param {string} projectDir
 * @param {string} sessionId
 * @param {{ event: string, by: string } & Record<string, unknown>} entry
 * @returns {boolean} 기록했으면 true
 */
export function appendEvent(projectDir, sessionId, entry) {
  if (!SAFE_SESSION_ID.test(sessionId)) return false;

  const root = join(projectDir, ".your-call");
  const ledgerDir = join(root, "ledger");
  mkdirSync(ledgerDir, { recursive: true });
  keepLedgerOutOfGit(root);

  const line = JSON.stringify({ v: FORMAT_VERSION, ts: new Date().toISOString(), session_id: sessionId, ...entry });
  appendFileSync(join(ledgerDir, `${sessionId}.jsonl`), `${line}\n`);
  return true;
}

/**
 * 스킬처럼 $CLAUDE_PROJECT_DIR을 받지 못하는 쪽이 기록 폴더를 찾는다. 현재 폴더에서 위로 올라간다.
 * @param {string} startDir
 * @returns {string | null} 기록 폴더가 있는 프로젝트 폴더
 */
export function findProjectDir(startDir) {
  for (let dir = resolve(startDir); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".your-call", "ledger"))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/**
 * 한 세션의 기록을 읽는다. 해석할 수 없는 줄은 건너뛴다.
 * @param {string} projectDir
 * @param {string} sessionId
 * @returns {Array<Record<string, any>>} 기록 파일이 없거나 session_id가 안전하지 않으면 빈 배열
 */
export function readEvents(projectDir, sessionId) {
  if (!SAFE_SESSION_ID.test(sessionId)) return [];
  let text;
  try {
    text = readFileSync(join(projectDir, ".your-call", "ledger", `${sessionId}.jsonl`), "utf8");
  } catch {
    return [];
  }
  return text.split("\n").flatMap((line) => {
    try {
      return line === "" ? [] : [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

/**
 * hook이 다음 실행을 위해 남기는 작은 상태. 기록 폴더 아래에 두어 기록과 함께 커밋에서 빠진다.
 * @param {string} projectDir
 * @param {string} sessionId
 * @param {string} name 상태 주인 hook의 이름
 */
function statePath(projectDir, sessionId, name) {
  if (!SAFE_SESSION_ID.test(sessionId)) return null;
  return join(projectDir, ".your-call", "ledger", ".state", `${sessionId}.${name}.json`);
}

/**
 * @param {string} projectDir
 * @param {string} sessionId
 * @param {string} name
 * @returns {Record<string, unknown>} 없거나 읽을 수 없으면 빈 객체
 */
export function readState(projectDir, sessionId, name) {
  const path = statePath(projectDir, sessionId, name);
  if (!path) return {};
  try {
    const state = JSON.parse(readFileSync(path, "utf8"));
    return state !== null && typeof state === "object" ? state : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} projectDir
 * @param {string} sessionId
 * @param {string} name
 * @param {Record<string, unknown>} state
 */
export function writeState(projectDir, sessionId, name, state) {
  const path = statePath(projectDir, sessionId, name);
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  keepLedgerOutOfGit(join(projectDir, ".your-call"));
  writeFileSync(path, JSON.stringify(state));
}

/**
 * 기록에는 입력 원문이 들어가므로 기본은 커밋하지 않는다. 이미 있는 .gitignore는 건드리지 않는다.
 * @param {string} root
 */
function keepLedgerOutOfGit(root) {
  try {
    writeFileSync(join(root, ".gitignore"), "ledger/\n", { flag: "wx" });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") throw error;
  }
}
