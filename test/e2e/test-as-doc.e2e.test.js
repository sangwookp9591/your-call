// 실제 Claude Code 세션을 연다. 모델 호출 비용이 들어서 `npm run test:e2e`로만 돈다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, pluginDir } from "../helpers.js";

test("TD6: 정해 둔 표본(기대 없는 이름, 원시 값 뭉치, 설명 없는 숫자, 세 기준을 지킨 테스트)에 실제 에이전트를 돌리면 앞의 셋을 근거와 함께 짚고 넷째는 짚지 않는다", () => {
  const projectDir = makeProjectDir();
  mkdirSync(join(projectDir, ".your-call", "ledger"), { recursive: true });
  mkdirSync(join(projectDir, "test"));
  writeFileSync(
    join(projectDir, "test", "cart.test.js"),
    [
      'test("works", () => {',
      "  assert.equal(totalOf(cartWith(book())), priceOf(book()));",
      "});",
      "",
      'test("쿠폰을 적용하면 할인된 금액을 낸다", () => {',
      '  const order = { u: 7, i: [{ s: "A-1", q: 2, p: 6400 }], c: "X10", f: true };',
      "  assert.equal(pay(order).amount, 12800);",
      "});",
      "",
      'test("배송비 무료 기준을 넘긴 장바구니는 배송비를 내지 않는다", () => {',
      "  const cart = cartWith(book(), book());",
      "  assert.ok(totalOf(cart) >= FREE_SHIPPING_THRESHOLD);",
      "  assert.equal(shippingFeeOf(cart), 0);",
      "});",
      "",
    ].join("\n"),
  );

  const run = spawnSync("claude", ["--plugin-dir", pluginDir, "--allowedTools", "Agent,Read,Grep,Glob", "-p", "/your-call:testdoc test/cart.test.js"], {
    cwd: projectDir,
    encoding: "utf8",
    timeout: 600_000,
  });

  assert.equal(run.status, 0, run.stderr);
  const out = run.stdout;
  assert.match(out, /works/, out);
  assert.match(out, /12800/, out);
  assert.match(out, /cart\.test\.js:1\b/, out);
  assert.match(out, /cart\.test\.js:6\b/, out);
  assert.match(out, /cart\.test\.js:7\b/, out);
  assert.doesNotMatch(out, /\/private\/var|\/var\/folders/, "절대 경로가 나옴");
  // 세 기준을 지킨 테스트(10줄)는 짚지 않는다: 그 행이 세 기준 모두 지킨 상태로 나온다.
  const kept = out.split("\n").find((line) => /cart\.test\.js:10\b/.test(line) && line.startsWith("|")) ?? "";
  assert.match(kept, /조건과 기대 있음/, out);
  assert.match(kept, /도메인 어휘/, out);
  assert.match(kept, /설명 없는 숫자 없음/, out);
  assert.doesNotMatch(kept, /원시 값:|설명 없는 숫자:|기대가 없/, out);
});
