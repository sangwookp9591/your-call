import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const pluginDir = fileURLToPath(new URL("../plugins/your-call", import.meta.url));

/** 기록이 쌓일 빈 프로젝트 폴더를 만든다. */
export function makeProjectDir() {
  return mkdtempSync(join(tmpdir(), "your-call-project-"));
}

/**
 * Claude Code가 하는 것처럼 hook을 실행한다: stdin으로 입력 JSON, 환경 변수로 프로젝트 폴더.
 * @param {string} hook 예: "ledger-open"
 * @param {{ stdin: string, projectDir?: string, cwd?: string }} options
 */
export function runHook(hook, { stdin, projectDir, cwd }) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  if (projectDir !== undefined) env.CLAUDE_PROJECT_DIR = projectDir;

  return spawnSync(process.execPath, [join(pluginDir, "hooks", `${hook}.js`)], {
    input: stdin,
    env,
    cwd,
    encoding: "utf8",
  });
}
