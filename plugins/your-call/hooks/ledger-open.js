// serves: P1 — 세션이 시작되면 그 세션의 기록 파일에 session-open 한 줄을 남긴다.

import { capture } from "../lib/capture.js";

await capture((input) => ({ event: "session-open", by: "ledger-open", source: input.source ?? null }));
