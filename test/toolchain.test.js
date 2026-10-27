import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginDir = join(root, "plugins", "your-call");
const tsc = join(root, "node_modules", ".bin", "tsc");

/** 설치 폴더를 개발 폴더 밖 임시 위치로 복사한다. 상위의 package.json과 node_modules가 보이지 않게 하려는 것이다. */
function detachPlugin() {
  const detached = mkdtempSync(join(tmpdir(), "your-call-detached-"));
  cpSync(pluginDir, detached, { recursive: true });
  return detached;
}

test("E1: 런타임 의존성은 없고, 개발 의존성은 typescript 7.0.2와 @types/node뿐이다", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

  assert.equal(pkg.dependencies, undefined);
  assert.deepEqual(Object.keys(pkg.devDependencies).sort(), ["@types/node", "typescript"]);
  assert.equal(pkg.devDependencies.typescript, "7.0.2");
});

test("E2: 플러그인 코드와 테스트가 strict 타입 검사를 오류 없이 통과한다", () => {
  const check = spawnSync(tsc, ["-p", join(root, "tsconfig.json")], { encoding: "utf8" });

  assert.equal(check.status, 0, check.stdout);
});

test("E3: 설치 폴더에는 테스트 파일이 없다", () => {
  const files = readdirSync(pluginDir, { recursive: true, encoding: "utf8" });

  assert.deepEqual(files.filter((file) => file.endsWith(".test.js")), []);
});

test("E4: 설치 폴더만 따로 떼어 내도 node_modules 없이 import된다", async () => {
  const detached = detachPlugin();
  try {
    const hookInput = await import(pathToFileURL(join(detached, "lib", "hook-input.js")).href);

    assert.equal(typeof hookInput.parseHookInput, "function");
  } finally {
    rmSync(detached, { recursive: true, force: true });
  }
});

test("E6: 설치 폴더는 Node의 ESM 추측 없이도 import된다", () => {
  const detached = detachPlugin();
  try {
    const hookInputUrl = pathToFileURL(join(detached, "lib", "hook-input.js")).href;
    const run = spawnSync(
      process.execPath,
      ["--no-experimental-detect-module", "--input-type=module", "-e", `await import(${JSON.stringify(hookInputUrl)});`],
      { encoding: "utf8" },
    );

    assert.equal(run.status, 0, run.stderr);
  } finally {
    rmSync(detached, { recursive: true, force: true });
  }
});

test("E5: 타입이 틀린 코드를 넣으면 타입 검사가 실패한다", () => {
  const fixture = join(root, "test", "fixtures", "type-error", "tsconfig.json");
  const check = spawnSync(tsc, ["-p", fixture], { encoding: "utf8" });

  assert.notEqual(check.status, 0);
  assert.match(check.stdout, /TS2322/);
});
