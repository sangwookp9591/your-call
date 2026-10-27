// serves: P11 — capture hook들의 공통 틀: 입력 읽기 → 기록할 곳 확인 → 한 줄 덧붙이기.
// 입력이 잘못되었거나 기록할 곳이 없으면 조용히 끝낸다 (작업을 막지 않는다). stdout에는 쓰지 않는다.
// 기록을 쓸 수 없으면 오류가 그대로 올라가 exit 1, 작업을 막지 않는 오류로 사용자에게 보인다.

import { readHookInput } from "./hook-input.js";
import { appendEvent } from "./ledger.js";

/** @typedef {{ event: string, by: string } & Record<string, unknown>} Entry */

/**
 * @param {(input: Record<string, unknown>, where: { projectDir: string, sessionId: string }) => Entry | Entry[] | null} toEntries
 *   이 입력에서 남길 줄. 여러 줄이면 배열, 남길 것이 없으면 null.
 */
export async function capture(toEntries) {
  const input = await readHookInput();
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  const sessionId = input.ok ? input.value.session_id : undefined;
  if (!input.ok || !projectDir || typeof sessionId !== "string") return;

  // prompt_id는 입력 하나와 그 뒤의 모든 이벤트를 다음 입력 전까지 묶는다. /ledger는 이것으로 턴을 묶는다.
  const promptId = input.value.prompt_id ?? null;
  for (const entry of [toEntries(input.value, { projectDir, sessionId }) ?? []].flat()) {
    appendEvent(projectDir, sessionId, { prompt_id: promptId, ...entry });
  }
}
