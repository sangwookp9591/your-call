// serves: P1 — 어떤 절차(스킬)를 불러왔는지, 그리고 그걸 누가 골랐는지(사람의 /명령인지, AI의 판단인지) 기록한다.

import { capture } from "../lib/capture.js";

await capture((input) => {
  if (input.hook_event_name === "UserPromptExpansion") {
    if (typeof input.command_name !== "string") return null;
    return {
      event: "skill",
      by: "skill-capture",
      name: input.command_name,
      args: typeof input.command_args === "string" ? input.command_args : null,
      command_source: input.command_source ?? null,
      expansion_type: input.expansion_type ?? null,
      invoked_by: "human",
    };
  }

  if (input.tool_name !== "Skill") return null;
  const call = /** @type {any} */ (input.tool_input);
  if (typeof call?.skill !== "string") return null;
  return {
    event: "skill",
    by: "skill-capture",
    name: call.skill,
    args: typeof call.args === "string" ? call.args : null,
    invoked_by: "ai",
    tool_use_id: input.tool_use_id ?? null,
  };
});
