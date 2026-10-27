// serves: P1 — AI가 누구에게 무엇을 맡겼는지 위임 원문 그대로 기록한다.

import { capture } from "../lib/capture.js";

await capture((input) => {
  if (input.tool_name !== "Agent") return null;
  const call = /** @type {any} */ (input.tool_input);
  if (typeof call?.prompt !== "string") return null;
  return {
    event: "agent",
    by: "agent-capture",
    description: typeof call.description === "string" ? call.description : null,
    subagent_type: typeof call.subagent_type === "string" ? call.subagent_type : null,
    model: typeof call.model === "string" ? call.model : null,
    prompt: call.prompt,
    tool_use_id: input.tool_use_id ?? null,
  };
});
