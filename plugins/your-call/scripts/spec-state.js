// serves: P13, P14 — /spec이 열릴 때 지금 상태를 사실대로 보여 준다: 작업 이름, 확정 케이스, 이전 검토.
// 판단하지 않는다. 이름이 없거나 규칙 밖이면 그렇다고만 말하고, 이름을 지어내지 않는다 (P3).
//   node spec-state.js <작업 이름> [나머지 말은 무시]

import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { findProjectDir } from "../lib/ledger.js";
import { casesPath, readCases } from "../lib/spec.js";

const RULE = "작업 이름에는 영문, 숫자, _, -만 쓸 수 있습니다. 예: /your-call:spec coupon-expiry";

/** @param {string} path */
function reviewTitles(path) {
  try {
    return readFileSync(path, "utf8").split("\n").filter((line) => line.startsWith("## ")).map((line) => line.slice(3).trim());
  } catch {
    return [];
  }
}

const work = process.argv[2] ?? "";
const projectDir = findProjectDir(process.cwd());

let output;
if (!projectDir) {
  output = ["프로젝트 폴더(.your-call)를 찾지 못했습니다. your-call이 켜진 세션의 프로젝트 안에서 실행해 주세요."];
} else if (work === "") {
  output = ["작업 이름이 없습니다.", RULE];
} else if (casesPath(projectDir, work) === null) {
  output = [`작업 이름 "${work}"은(는) 쓸 수 없습니다.`, RULE];
} else {
  const cases = readCases(projectDir, work);
  const path = casesPath(projectDir, work) ?? "";
  const reviews = reviewTitles(join(dirname(path), "proposals.md"));
  output = [
    `## 스펙: ${work}`,
    `- 확정 케이스 파일: ${relative(projectDir, path)}`,
    "",
    `### 확정 케이스 (${cases.length})`,
    ...(cases.length > 0 ? cases.map((c) => `- ${c.id}: ${c.text}`) : ["아직 확정된 케이스가 없습니다."]),
    "",
    "### 이전 검토 (proposals.md)",
    ...(reviews.length > 0 ? reviews.map((title) => `- ${title}`) : ["아직 검토 기록이 없습니다."]),
  ];
}
console.log(output.join("\n"));
