// serves: P1 — AI가 어떤 파일을 바꿨는지 도구와 경로만 기록한다. 내용과 diff는 git의 일이라 남기지 않는다.

import { capture } from "../lib/capture.js";

/** 도구마다 바꾼 파일 경로가 들어 있는 입력 필드 */
const PATH_FIELD = new Map([
  ["Write", "file_path"],
  ["Edit", "file_path"],
  ["NotebookEdit", "notebook_path"],
]);

await capture((input) => {
  const field = PATH_FIELD.get(String(input.tool_name));
  const path = field ? /** @type {any} */ (input.tool_input)?.[field] : undefined;
  if (typeof path !== "string") return null;
  return { event: "edit", by: "edit-capture", tool: input.tool_name, file_path: path, tool_use_id: input.tool_use_id ?? null };
});
