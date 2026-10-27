import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
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

/**
 * 같은 이벤트의 hook들이 동시에 도는 상황을 만들기 위해, 끝나기를 기다리지 않고 hook을 띄운다.
 * @param {string} hook
 * @param {{ stdin: string, projectDir: string }} options
 * @returns {Promise<number | null>} exit code
 */
export function startHook(hook, { stdin, projectDir }) {
  const child = spawn(process.execPath, [join(pluginDir, "hooks", `${hook}.js`)], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
  child.stdin.end(stdin);
  return new Promise((resolve) => child.on("close", resolve));
}

/**
 * @param {string} projectDir
 * @param {string} sessionId
 * @returns {Array<Record<string, any>>}
 */
export function readLedger(projectDir, sessionId) {
  const file = join(projectDir, ".your-call", "ledger", `${sessionId}.jsonl`);
  return readFileSync(file, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
}
