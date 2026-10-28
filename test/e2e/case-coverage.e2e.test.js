// 실제 Claude Code 세션을 연다. 모델 호출 비용이 들어서 `npm run test:e2e`로만 돈다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendCases } from "../../plugins/your-call/lib/spec.js";
import { makeProjectDir, pluginDir } from "../helpers.js";

test("CV4: 정해 둔 표본(C1 짝 있음, C2 없음, C3 단언이 다름, 케이스에 없는 C9)에 실제 에이전트를 돌리면 네 가지를 근거와 함께 짚는다", () => {
  const projectDir = makeProjectDir();
  mkdirSync(join(projectDir, ".your-call", "ledger"), { recursive: true });
  mkdirSync(join(projectDir, "test"));
  appendCases(projectDir, "coupon-expiry", ["만료 시각이 지난 쿠폰은 사용할 수 없다", "만료 시각과 같은 순간은 사용할 수 있다", "만료 판정은 서버 시간 기준이다"]);
  writeFileSync(
    join(projectDir, "test", "coupon.test.js"),
    [
      'test("C1: 만료 시각이 지난 쿠폰은 사용할 수 없다", () => {',
      '  assert.equal(canUse(coupon({ expiresAt: "10:00" }), at("10:01")), false);',
      "});",
      "",
      'test("C3: 만료 판정은 서버 시간 기준이다", () => {',
      '  assert.equal(canUse(coupon({ expiresAt: "10:00" }), at("09:59")), true);',
      "});",
      "",
      'test("C9: 오프라인 쿠폰은 매장에서만 쓸 수 있다", () => {',
      '  assert.equal(canUse(offline(), online()), false);',
      "});",
      "",
    ].join("\n"),
  );

  const run = spawnSync("claude", ["--plugin-dir", pluginDir, "--allowedTools", "Agent,Read,Grep,Glob,Bash(node:*)", "-p", "/your-call:coverage coupon-expiry test/coupon.test.js"], {
    cwd: projectDir,
    encoding: "utf8",
    timeout: 600_000,
  });

  assert.equal(run.status, 0, run.stderr);
  const out = run.stdout;
  assert.match(out, /C1[^\n]*짝 있음/, out);
  assert.match(out, /C2[^\n]*짝 없음/, out);
  assert.match(out, /C3[^\n]*단언이 다름/, out);
  assert.match(out, /C9/, out);
  assert.match(out, /coupon\.test\.js:\d+/, out);
});
