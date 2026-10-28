import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvent } from "../plugins/your-call/lib/ledger.js";
import { appendCases, casesPath, readCases } from "../plugins/your-call/lib/spec.js";
import { makeProjectDir } from "./helpers.js";

const specModule = fileURLToPath(new URL("../plugins/your-call/lib/spec.js", import.meta.url));

/** @param {string} projectDir @param {string} work */
const casesFile = (projectDir, work) => readFileSync(join(projectDir, ".your-call", "spec", work, "cases.md"), "utf8");

test("SP1: 작업 이름이 [A-Za-z0-9_-]+가 아니면 아무것도 쓰지 않고, 읽으면 빈 목록이다", () => {
  const projectDir = makeProjectDir();

  for (const work of ["", "..", "../escape", "a/b", "쿠폰 만료", "coupon expiry"]) {
    assert.deepEqual(appendCases(projectDir, work, ["만료된 쿠폰은 쓸 수 없다"]), [], work);
    assert.deepEqual(readCases(projectDir, work), [], work);
    assert.equal(casesPath(projectDir, work), null, work);
  }
  assert.equal(existsSync(join(projectDir, ".your-call")), false);

  // 같은 틀에서 안전한 이름이면 쓴다: 위의 결과가 함수가 아무것도 안 해서가 아님을 보인다.
  assert.deepEqual(appendCases(projectDir, "coupon_expiry-2", ["만료된 쿠폰은 쓸 수 없다"]), [{ id: "C1", text: "만료된 쿠폰은 쓸 수 없다" }]);
});

test("SP2: 처음 덧붙일 때 .your-call/spec/<작업>/cases.md를 만들고 맨 위에 제목과 안내 주석 한 줄을 둔다", () => {
  const projectDir = makeProjectDir();

  appendCases(projectDir, "coupon-expiry", ["만료 시각이 지난 쿠폰은 사용할 수 없다"]);

  assert.equal(casesPath(projectDir, "coupon-expiry"), join(projectDir, ".your-call", "spec", "coupon-expiry", "cases.md"));
  assert.equal(
    casesFile(projectDir, "coupon-expiry"),
    "# coupon-expiry\n\n<!-- 사람이 확정한 케이스만 둡니다. AI는 이 파일을 쓸 수 없습니다. -->\n\n- C1: 만료 시각이 지난 쿠폰은 사용할 수 없다\n",
  );
});

test("SP3: 번호는 파일에 있는 가장 큰 C번호 다음부터 매기고, 문장은 앞뒤 공백만 정리해 그대로 쓴다", () => {
  const projectDir = makeProjectDir();
  appendCases(projectDir, "coupon-expiry", ["만료 시각이 지난 쿠폰은 사용할 수 없다"]);
  // 사람이 편집기로 C7을 직접 넣었다.
  writeFileSync(casesPath(projectDir, "coupon-expiry") ?? "", `${casesFile(projectDir, "coupon-expiry")}- C7: 사람이 직접 넣은 케이스\n`);

  const added = appendCases(projectDir, "coupon-expiry", ["   만료 판정은  서버 시간 기준이다 ,  예외 없음\t "]);

  assert.deepEqual(added, [{ id: "C8", text: "만료 판정은  서버 시간 기준이다 ,  예외 없음" }]);
  assert.match(casesFile(projectDir, "coupon-expiry"), /\n- C8: 만료 판정은 {2}서버 시간 기준이다 , {2}예외 없음\n$/);
});

test("SP4: 여러 개를 한 번에 덧붙이면 받은 순서대로 이어지는 번호를 받고, append 한 번으로 쓴다", async () => {
  const projectDir = makeProjectDir();

  assert.deepEqual(appendCases(projectDir, "w", ["가", "나", "다"]), [
    { id: "C1", text: "가" },
    { id: "C2", text: "나" },
    { id: "C3", text: "다" },
  ]);

  // 두 프로세스가 동시에 큰 묶음을 덧붙여도 한 묶음의 줄은 섞이지 않고 붙어 있다.
  const batch = (/** @type {string} */ tag) => Array.from({ length: 200 }, (_, i) => `${tag}-${i}`);
  const run = (/** @type {string} */ tag) =>
    new Promise((done) => {
      const script = `import { appendCases } from ${JSON.stringify(specModule)};
        appendCases(${JSON.stringify(projectDir)}, "w", ${JSON.stringify(batch(tag))});`;
      spawn(process.execPath, ["--input-type=module", "-e", script]).on("exit", done);
    });
  await Promise.all([run("a"), run("b")]);

  const texts = readCases(projectDir, "w").map((c) => c.text).slice(3);
  assert.equal(texts.length, 400);
  const firstTag = texts[0].split("-")[0];
  const secondTag = firstTag === "a" ? "b" : "a";
  assert.deepEqual(texts, [...batch(firstTag), ...batch(secondTag)]);
});

test("SP5: 문장 안의 줄바꿈은 공백 하나로 바꾸고, 비어 있는 문장은 쓰지 않는다", () => {
  const projectDir = makeProjectDir();

  const added = appendCases(projectDir, "w", ["만료 시각이 지나면\n사용할 수 없다", "  \n\t", "", "만료는\r\n\r\n서버 시간"]);

  assert.deepEqual(added, [
    { id: "C1", text: "만료 시각이 지나면 사용할 수 없다" },
    { id: "C2", text: "만료는 서버 시간" },
  ]);
  assert.deepEqual(readCases(projectDir, "w"), added);
});

test("SP6: readCases는 '- C<n>: 문장' 줄만 파일 순서대로 읽고, 제목·빈 줄·사람이 적은 메모는 건너뛴다", () => {
  const projectDir = makeProjectDir();
  appendCases(projectDir, "w", ["가"]);
  writeFileSync(
    casesPath(projectDir, "w") ?? "",
    `${casesFile(projectDir, "w")}\n메모: 오프라인 쿠폰은 다음 작업에서\n  - C9: 들여 쓴 줄은 케이스가 아니다\n- C3: 다\n- C2: 나\n- 번호 없는 항목\n`,
  );

  assert.deepEqual(readCases(projectDir, "w"), [
    { id: "C1", text: "가" },
    { id: "C3", text: "다" },
    { id: "C2", text: "나" },
  ]);
});

test("SP7: 사람이 편집기로 고치거나 지운 줄은 그대로 반영된다. 파일이 유일한 기준이다", () => {
  const projectDir = makeProjectDir();
  appendCases(projectDir, "w", ["가", "나", "다"]);
  const path = casesPath(projectDir, "w") ?? "";
  writeFileSync(path, casesFile(projectDir, "w").replace("- C1: 가\n", "").replace("- C2: 나", "- C2: 나 (사람이 고침)"));

  assert.deepEqual(readCases(projectDir, "w"), [
    { id: "C2", text: "나 (사람이 고침)" },
    { id: "C3", text: "다" },
  ]);
  assert.deepEqual(appendCases(projectDir, "w", ["라"]), [{ id: "C4", text: "라" }]);
});

test("SP8: .your-call/.gitignore를 만들지도 바꾸지도 않고, ledger의 규칙에 spec이 숨지 않는다", () => {
  const fresh = makeProjectDir();
  appendCases(fresh, "w", ["가"]);
  assert.equal(existsSync(join(fresh, ".your-call", ".gitignore")), false);

  const projectDir = makeProjectDir();
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: projectDir }).status, 0);
  appendEvent(projectDir, "s1", { event: "session-open", by: "test" });
  const before = readFileSync(join(projectDir, ".your-call", ".gitignore"), "utf8");

  appendCases(projectDir, "w", ["가"]);

  assert.equal(readFileSync(join(projectDir, ".your-call", ".gitignore"), "utf8"), before);
  const ignored = (/** @type {string} */ path) => spawnSync("git", ["check-ignore", "-q", path], { cwd: projectDir }).status;
  assert.equal(ignored(".your-call/spec/w/cases.md"), 1);
  // 같은 틀에서 기록 파일은 숨는다: 위의 1이 git이 아무것도 안 봐서가 아님을 보인다.
  assert.equal(ignored(".your-call/ledger/s1.jsonl"), 0);
});

test("SP9: 이미 있는 케이스와 같은 문장은 건너뛰고, 돌려주는 목록에는 기존 번호를 담는다", () => {
  const projectDir = makeProjectDir();
  appendCases(projectDir, "w", ["가", "나"]);

  const added = appendCases(projectDir, "w", ["나", "  다 ", "다", "가"]);

  assert.deepEqual(added, [
    { id: "C2", text: "나" },
    { id: "C3", text: "다" },
    { id: "C3", text: "다" },
    { id: "C1", text: "가" },
  ]);
  assert.deepEqual(readCases(projectDir, "w").map((c) => c.id), ["C1", "C2", "C3"]);
});

test("SP10: 취소선 줄(- C3: ~~문장~~)은 케이스로 읽지 않지만 그 번호는 다시 쓰이지 않는다", () => {
  const projectDir = makeProjectDir();
  appendCases(projectDir, "w", ["가", "나", "다"]);
  writeFileSync(casesPath(projectDir, "w") ?? "", casesFile(projectDir, "w").replace("- C3: 다", "- C3: ~~다~~"));

  assert.deepEqual(readCases(projectDir, "w").map((c) => c.id), ["C1", "C2"]);
  // 취소한 문장을 다시 확정하면 살아 있는 케이스가 아니므로 새 번호를 받는다.
  assert.deepEqual(appendCases(projectDir, "w", ["다"]), [{ id: "C4", text: "다" }]);
});

test("SP11: 사람이 마지막 줄바꿈 없이 저장한 파일에 덧붙여도 마지막 케이스 줄에 이어 붙지 않는다", () => {
  const projectDir = makeProjectDir();
  appendCases(projectDir, "w", ["가"]);
  writeFileSync(casesPath(projectDir, "w") ?? "", casesFile(projectDir, "w").replace(/\n$/, ""));

  appendCases(projectDir, "w", ["나"]);

  assert.deepEqual(readCases(projectDir, "w"), [
    { id: "C1", text: "가" },
    { id: "C2", text: "나" },
  ]);
});
