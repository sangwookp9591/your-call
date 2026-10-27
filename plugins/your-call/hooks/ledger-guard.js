// serves: P2, P7 — 기록은 hook만 쓴다. AI가 도구로 기록 폴더를 쓰려 하면 막는다 (프롬프트로 부탁하지 않고 검사로).
// 판단 재료(입력, 프로젝트 폴더, 경로)가 없으면 통과시킨다. 사용자의 파일 작업을 멈추지 않기 위해서다.

import { join, resolve } from "node:path";
import { readHookInput } from "../lib/hook-input.js";
import { appendEvent } from "../lib/ledger.js";
import { isWithin, realLocation } from "../lib/real-path.js";

/** 도구마다 쓰려는 파일 경로가 들어 있는 입력 필드 */
const PATH_FIELD = new Map([
  ["Write", "file_path"],
  ["Edit", "file_path"],
  ["NotebookEdit", "notebook_path"],
]);

const REASON =
  "your-call: .your-call/ledger/ 의 기록은 hook만 씁니다. AI는 이 폴더의 파일을 쓰거나 고칠 수 없습니다. " +
  "의도와 이유는 사람이 입력을 why:로 시작해 직접 밝힙니다.";

const input = await readHookInput();
const projectDir = process.env.CLAUDE_PROJECT_DIR;

if (input.ok && projectDir) {
  const { tool_name: tool, tool_input: toolInput, cwd, session_id: sessionId, prompt_id: promptId } = input.value;
  const field = PATH_FIELD.get(String(tool));
  const path = field ? /** @type {any} */ (toolInput)?.[field] : undefined;

  if (typeof path === "string") {
    const target = realLocation(resolve(typeof cwd === "string" ? cwd : projectDir, path));
    if (isWithin(target, realLocation(join(projectDir, ".your-call", "ledger")))) {
      process.exitCode = 2;
      process.stderr.write(`${REASON}\n`);
      try {
        if (typeof sessionId === "string") appendEvent(projectDir, sessionId, { prompt_id: promptId ?? null, event: "blocked", by: "ledger-guard", tool, file_path: path });
      } catch {
        // 막은 사실을 기록하지 못해도 막는 것은 그대로다.
      }
    }
  }
}
