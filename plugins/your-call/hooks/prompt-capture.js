// serves: P1 — 입력 원문을 손대지 않고 기록한다. 의도를 뽑아내지 않는다 (그건 intent-capture의 일).

import { capture } from "../lib/capture.js";

await capture((input) =>
  typeof input.prompt === "string"
    ? {
        event: "prompt",
        by: "prompt-capture",
        prompt_id: input.prompt_id ?? null,
        source: input.source ?? null,
        text: input.prompt,
      }
    : null,
);
