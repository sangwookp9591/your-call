// serves: P11 — capture hook들의 공통 틀: 입력 읽기 → 기록할 곳 확인 → 한 줄 덧붙이기.
// 입력이 잘못되었거나 기록할 곳이 없으면 조용히 끝낸다 (작업을 막지 않는다). stdout에는 쓰지 않는다.
// 기록을 쓸 수 없으면 오류가 그대로 올라가 exit 1, 작업을 막지 않는 오류로 사용자에게 보인다.

import { readHookInput } from "./hook-input.js";
import { appendEvent } from "./ledger.js";

/**
 * @param {(input: Record<string, unknown>) => ({ event: string, by: string } & Record<string, unknown>) | null} toEntry
 *   이 입력에서 남길 한 줄. 남길 것이 없으면 null.
 */
export async function capture(toEntry) {
  const input = await readHookInput();
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (!input.ok || !projectDir || typeof input.value.session_id !== "string") return;

  const entry = toEntry(input.value);
  if (entry) appendEvent(projectDir, input.value.session_id, entry);
}
