// serves: P1, P9 — 턴이 끝날 때 경계를 남기고, AI가 마지막에 한 말을 원문 그대로 둔다 (판정인지 증거인지 나중에 본다).
// 멈춤을 막지 않는다. 다른 Stop hook이 이미 돌고 있으면(stop_hook_active) 중복을 피해 건너뛴다.

import { capture } from "../lib/capture.js";

await capture((input) => {
  if (input.stop_hook_active === true) return null;
  return {
    event: "turn-close",
    by: "turn-close",
    prompt_id: input.prompt_id ?? null,
    last_message: typeof input.last_assistant_message === "string" ? input.last_assistant_message : null,
    background_tasks: Array.isArray(input.background_tasks) ? input.background_tasks.length : null,
  };
});
