// serves: P1 — 입력 원문을 손대지 않고 기록한다. 의도를 뽑아내지 않는다 (그건 intent-capture의 일).
// 기록 hook이므로 입력이 잘못되었거나 기록할 곳이 없으면 조용히 끝내고 작업을 막지 않는다. stdout에는 쓰지 않는다.

import { readHookInput } from "../lib/hook-input.js";
import { appendEvent } from "../lib/ledger.js";

const input = await readHookInput();
const projectDir = process.env.CLAUDE_PROJECT_DIR;

if (input.ok && projectDir && typeof input.value.session_id === "string" && typeof input.value.prompt === "string") {
  appendEvent(projectDir, input.value.session_id, {
    event: "prompt",
    by: "prompt-capture",
    prompt_id: input.value.prompt_id ?? null,
    source: input.value.source ?? null,
    text: input.value.prompt,
  });
}
