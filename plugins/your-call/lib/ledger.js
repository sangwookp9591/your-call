// serves: P1, P11 — 모든 hook이 따르는 기록 계약. 이벤트 하나 = JSONL 한 줄 덧붙이기.
// 같은 이벤트에 걸린 hook들은 동시에 돌기 때문에, 한 줄을 한 번의 append로 쓴다.

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
