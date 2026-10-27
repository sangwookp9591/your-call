// serves: P1 — 세션이 시작되면 그 세션의 기록 파일에 session-open 한 줄을 남긴다.
// 기록 hook이므로 입력이 잘못되었거나 기록할 곳이 없으면 조용히 끝내고 작업을 막지 않는다. stdout에는 쓰지 않는다.

import { readHookInput } from "../lib/hook-input.js";
import { appendEvent } from "../lib/ledger.js";

const input = await readHookInput();
const projectDir = process.env.CLAUDE_PROJECT_DIR;

if (input.ok && projectDir && typeof input.value.session_id === "string") {
  appendEvent(projectDir, input.value.session_id, {
    event: "session-open",
    by: "ledger-open",
    source: input.value.source ?? null,
  });
}
