// serves: P14, P7 — 확정 케이스(cases.md)는 사람이 정한다. AI가 도구로 쓰려 하면 막는다 (프롬프트로 부탁하지 않고 검사로).
// .your-call/spec/ 바로 아래 폴더의 cases.md는 작업 이름과 상관없이 지킨다. 그 밖(proposals.md 등)은 통과시킨다.
// 판단 재료(입력, 프로젝트 폴더, 경로)가 없으면 통과시킨다. 사용자의 파일 작업을 멈추지 않기 위해서다.

import { basename, dirname, join, resolve } from "node:path";
import { readHookInput } from "../lib/hook-input.js";
import { appendEvent } from "../lib/ledger.js";
import { realLocation } from "../lib/real-path.js";

/** 도구마다 쓰려는 파일 경로가 들어 있는 입력 필드 */
const PATH_FIELD = new Map([
  ["Write", "file_path"],
  ["Edit", "file_path"],
  ["NotebookEdit", "notebook_path"],
]);

const REASON =
  "your-call: cases.md에는 사람이 확정한 케이스만 둡니다. AI는 이 파일을 쓰거나 고칠 수 없습니다. " +
  "빠진 케이스나 고칠 점은 같은 폴더의 proposals.md에 근거와 함께 적고, 확정은 사람에게 물어 받으세요.";

const input = await readHookInput();
const projectDir = process.env.CLAUDE_PROJECT_DIR;

if (input.ok && projectDir) {
  const { tool_name: tool, tool_input: toolInput, cwd, session_id: sessionId, prompt_id: promptId } = input.value;
  const field = PATH_FIELD.get(String(tool));
  const path = field ? /** @type {any} */ (toolInput)?.[field] : undefined;

  if (typeof path === "string") {
    const target = realLocation(resolve(typeof cwd === "string" ? cwd : projectDir, path));
    const specDir = realLocation(join(projectDir, ".your-call", "spec"));
    // macOS 기본 파일시스템은 대소문자를 구분하지 않으므로 비교도 구분하지 않는다.
    const isCases = basename(target).toLowerCase() === "cases.md" && dirname(dirname(target)).toLowerCase() === specDir.toLowerCase();
    if (isCases) {
      process.exitCode = 2;
      process.stderr.write(`${REASON}\n`);
      try {
        if (typeof sessionId === "string") appendEvent(projectDir, sessionId, { prompt_id: promptId ?? null, event: "blocked", by: "spec-guard", tool, file_path: path });
      } catch {
        // 막은 사실을 기록하지 못해도 막는 것은 그대로다.
      }
    }
  }
}
