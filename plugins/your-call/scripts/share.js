// serves: P10, P1, P0 — 기록 중 무엇을 리뷰어에게 보일지는 사람이 인자로 정하고, 파일은 이 스크립트가 쓴다. AI는 고르지도 쓰지도 않는다.
//   node share.js                      이번 세션의 턴 목록 (파일은 쓰지 않음)
//   node share.js 3 7                  3번, 7번 턴의 원문을 넣어 .your-call/shared/<세션>.md 작성
//   node share.js <session_id> [번호...] 지난 세션도 같은 방식

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectDir, listSessions, readEvents } from "../lib/ledger.js";
import { summarize } from "../lib/ledger-stats.js";
import { tokenLikeKinds } from "../lib/secrets.js";
import { sharedDocument, turnList, turnSection } from "../lib/share.js";

const NUMBER = /^\d+$/;

/** @param {string[]} args */
function run(args) {
  const projectDir = findProjectDir(process.cwd());
  if (!projectDir) return ["아직 기록이 없습니다 (.your-call/ledger 폴더를 찾지 못했습니다)."];

  const named = args.length > 0 && !NUMBER.test(args[0]);
  const sessionId = named ? args[0] : process.env.CLAUDE_CODE_SESSION_ID;
  if (!sessionId) return ["세션을 알 수 없습니다 (CLAUDE_CODE_SESSION_ID가 없습니다). 세션 id를 함께 주세요."];
  // 목록에 있는 id만 받으므로 경로로 써도 ledger 밖으로 나갈 수 없다.
  if (!listSessions(projectDir).includes(sessionId)) return [`그 세션(${sessionId})의 기록이 없습니다.`];

  const summary = summarize(readEvents(projectDir, sessionId));
  const { turns } = summary;
  if (turns.length === 0) return [`그 세션(${sessionId})에는 아직 입력이 없습니다.`];
  const numberArgs = named ? args.slice(1) : args;
  if (numberArgs.length === 0) {
    return [`## ${sessionId}의 턴 (번호는 /your-call:ledger와 같습니다)`, ...turnList(turns), "", "원문을 공유할 턴 번호를 주면 공유본을 씁니다."];
  }

  const problems = [];
  for (const arg of numberArgs) {
    const turn = NUMBER.test(arg) ? turns[Number(arg) - 1] : undefined;
    if (!NUMBER.test(arg)) problems.push(`- ${arg}: 번호가 아닙니다`);
    else if (!turn) problems.push(`- ${arg}번: 없는 번호입니다 (1~${turns.length})`);
    else if (!turn.human) problems.push(`- ${arg}번: 기계가 넣은 형식이라 원문을 고를 수 없습니다`);
  }
  if (problems.length > 0) return ["공유본을 쓰지 않았습니다.", ...problems];

  const picked = [...new Set(numberArgs.map(Number))].sort((a, b) => a - b);
  const sections = turns.map((turn, i) => turnSection(turn, i + 1, picked.includes(i + 1), projectDir));
  const leaks = sections.flatMap((section, i) => {
    const kinds = tokenLikeKinds(section);
    return kinds.length > 0 ? [`- ${i + 1}번: 토큰처럼 보이는 문자열이 있습니다 (${kinds.join(", ")})`] : [];
  });
  if (leaks.length > 0) {
    return [
      "공유본을 쓰지 않았습니다. 커밋될 파일에 토큰이 섞일 수 있습니다.",
      ...leaks,
      `그 턴의 원문을 고르지 않거나, 기록(.your-call/ledger/${sessionId}.jsonl)에서 그 문자열을 직접 지운 뒤 다시 부르세요.`,
    ];
  }

  const relativePath = join(".your-call", "shared", `${sessionId}.md`);
  mkdirSync(join(projectDir, ".your-call", "shared"), { recursive: true });
  writeFileSync(join(projectDir, relativePath), sharedDocument({ sessionId, summary, picked, sections }));
  return [
    `공유본을 썼습니다: ${relativePath}`,
    `- 원문을 공유한 턴: ${picked.join(", ")} / 전체 ${turns.length}턴`,
    "- 이 파일은 커밋 대상입니다. 커밋 전에 직접 열어 보세요.",
  ];
}

console.log(run(process.argv.slice(2)).join("\n"));
