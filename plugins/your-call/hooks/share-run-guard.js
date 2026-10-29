// serves: P0, P10, P7 — 무엇을 리뷰어에게 공개할지는 사람이 정한다. AI가 Bash로 공유본 스크립트를 직접 실행해 대신 고르려 하면 막는다.
// 사람의 /your-call:share는 스킬의 ! 실행이라 도구 호출이 아니므로 여기를 거치지 않는다.
// 문자열 검사라 작정한 우회(변수 조합, 복사 뒤 실행)는 막지 못한다. 무심코 실행하는 것을 막는다.
// 판단 재료(입력, 프로젝트 폴더, 명령)가 없으면 통과시킨다. 사용자의 작업을 멈추지 않기 위해서다.

import { readHookInput } from "../lib/hook-input.js";
import { appendEvent } from "../lib/ledger.js";

/** 셋이 다 있어야 your-call의 공유본 스크립트 실행으로 본다. 사용자 프로젝트의 share.js는 막지 않는다. */
const RUNS_NODE = /\bnode\b/;
const SHARE_SCRIPT = /share\.js\b/;
const PLUGIN_MARK = /your-call|claude_plugin_root/;

const REASON =
  "your-call: 공유본에 무엇을 넣을지는 사람이 정합니다. AI는 share.js를 직접 실행할 수 없습니다. " +
  "공유본은 사람이 /your-call:share [턴 번호...]로 만듭니다.";

const input = await readHookInput();
const projectDir = process.env.CLAUDE_PROJECT_DIR;

if (input.ok && projectDir) {
  const { tool_name: tool, tool_input: toolInput, session_id: sessionId, prompt_id: promptId } = input.value;
  const command = /** @type {any} */ (toolInput)?.command;

  if (tool === "Bash" && typeof command === "string") {
    const lower = command.toLowerCase();
    if (RUNS_NODE.test(lower) && SHARE_SCRIPT.test(lower) && PLUGIN_MARK.test(lower)) {
      process.exitCode = 2;
      process.stderr.write(`${REASON}\n`);
      try {
        // /ledger와 공유본이 "막힌 쓰기"로 보여 주도록 지키는 곳을 file_path에 둔다.
        if (typeof sessionId === "string") {
          appendEvent(projectDir, sessionId, { prompt_id: promptId ?? null, event: "blocked", by: "share-run-guard", tool, file_path: ".your-call/shared/", command });
        }
      } catch {
        // 막은 사실을 기록하지 못해도 막는 것은 그대로다.
      }
    }
  }
}
