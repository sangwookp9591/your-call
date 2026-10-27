// serves: P3 — /declare가 이번 세션에 사람이 밝힌 의도를 원문 그대로 보여 주게 한다. 기록은 읽기만 한다.
// 세션을 알 수 없으면 추측하지 않고 그렇게 말한다.

import { findProjectDir, readEvents } from "../lib/ledger.js";

const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
const projectDir = findProjectDir(process.cwd());

if (!sessionId) {
  console.log("세션을 알 수 없습니다 (CLAUDE_CODE_SESSION_ID가 없습니다). 기록된 의도를 보여 줄 수 없습니다.");
} else if (!projectDir) {
  console.log("아직 기록이 없습니다 (.your-call/ledger 폴더를 찾지 못했습니다).");
} else {
  const intents = readEvents(projectDir, sessionId).filter((entry) => entry.event === "intent" && typeof entry.text === "string");
  if (intents.length === 0) {
    console.log("이번 세션에 기록된 의도가 없습니다.");
  } else {
    for (const intent of intents) {
      console.log(`- [${intent.ts}] ${intent.text.replaceAll("\n", "\n  ")}`);
    }
  }
}
