// serves: P10, P1 — 리뷰어가 볼 수 있게, 커밋되지 않는 기록에서 사실만 뽑아 공유본으로 만든다.
// 입력 원문은 사람이 고른 턴에만 넣는다. AI의 마지막 말과 위임 원문은 넣지 않는다(AI 설명보다 사실을 먼저).
// 같은 기록과 같은 번호면 같은 글이 나와야 공유본의 diff를 리뷰할 수 있다. 그래서 만든 시각 같은 것은 넣지 않는다.

import { isAbsolute, relative } from "node:path";
import { realLocation } from "./real-path.js";

/** @typedef {ReturnType<typeof import("./ledger-stats.js").summarize>} Summary */
/** @typedef {Summary["turns"][number]} Turn */

const SNIPPET = 80;

/** @param {string} text */
const clip = (text) => (text.length > SNIPPET ? `${text.slice(0, SNIPPET)}…` : text);
/** @param {unknown} ts */
const minute = (ts) => (typeof ts === "string" ? `${ts.slice(0, 16).replace("T", " ")}Z` : "시각 없음");
/** @param {unknown} labels */
const list = (labels) => (Array.isArray(labels) && labels.length > 0 ? labels.join(", ") : "없음");
/** @param {unknown} text */
const indented = (text) => String(text).replaceAll("\n", "\n  ");

/**
 * 번호 없이 불렀을 때 보여 줄 목록. 번호는 /ledger와 같다.
 * @param {Turn[]} turns
 */
export function turnList(turns) {
  return turns.map((turn, i) => {
    const head = `${i + 1}. [${minute(turn.at)}]`;
    return turn.human ? `${head} ${clip(turn.text.trimStart().split("\n")[0])}` : `${head} — 기계가 넣은 형식`;
  });
}

/**
 * 턴 하나의 절. 원문은 picked일 때만 넣는다.
 * @param {Turn} turn
 * @param {number} number
 * @param {boolean} picked
 * @param {string} projectDir
 */
export function turnSection(turn, number, picked, projectDir) {
  /** @param {string} path */
  const shortPath = (path) => {
    if (!isAbsolute(path)) return path;
    const inside = relative(realLocation(projectDir), realLocation(path));
    return inside.startsWith("..") ? path : inside;
  };
  const head = `## ${number}. [${minute(turn.at)}]`;
  const lines = [];
  if (!turn.human) lines.push(`${head} — 기계가 넣은 형식`);
  else if (!picked) lines.push(`${head} — 원문 공유 안 함`);
  else {
    // 원문 안의 ``` 때문에 블록이 끊기지 않게, 원문에 있는 가장 긴 백틱 줄보다 길게 감싼다.
    const longestRun = Math.max(0, ...(turn.text.match(/`+/g) ?? []).map((run) => run.length));
    const fence = "`".repeat(Math.max(3, longestRun + 1));
    lines.push(head, "", `${fence}text`, turn.text, fence);
  }

  for (const intent of turn.intents) lines.push(`- 의도: ${indented(intent.text)}`);
  for (const choice of turn.choices) {
    const offered = Array.isArray(choice.offered) ? choice.offered.map((/** @type {any} */ option) => option.label) : [];
    const parts = [
      `- ⚑ 선택 「${choice.header ?? choice.question}」`,
      `질문: ${choice.question}`,
      `제시된 것: ${list(offered)}`,
      `AI 추천: ${list(choice.recommended)}`,
      `고른 것: ${list(choice.chosen)}`,
      `버린 것: ${list(choice.rejected)}`,
    ];
    if (choice.other_text != null) parts.push(`직접 쓴 답: "${indented(choice.other_text)}"`);
    if (choice.notes != null) parts.push(`메모: "${indented(choice.notes)}"`);
    parts.push(`이유: ${choice.reason ?? "(비어 있음)"}`);
    lines.push(parts.join(" · "));
  }
  for (const interrupt of turn.interrupts) lines.push(`- ⚑ ✋ 중단 (${interrupt.kind === "tool-use" ? "도구 사용 중" : "응답 중"})`);
  if (turn.skills.length > 0) {
    lines.push(`- 스킬: ${turn.skills.map((skill) => `${skill.name} (${skill.invoked_by === "human" ? "사람" : "AI"})`).join(", ")}`);
  }
  if (turn.agents.length > 0) {
    lines.push(`- 에이전트: ${turn.agents.map((agent) => `${agent.subagent_type ?? "기본"} "${agent.description ?? ""}"`).join(", ")}`);
  }
  if (turn.edits.length > 0) {
    lines.push(`- 바꾼 파일: ${[...new Set(turn.edits.map((edit) => shortPath(String(edit.file_path))))].join(", ")}`);
  }
  for (const blocked of turn.blocked) lines.push(`- 막힌 쓰기: ${blocked.tool} ${blocked.file_path}`);
  return lines.join("\n");
}

/**
 * @param {{ sessionId: string, summary: Summary, picked: number[], sections: string[] }} parts
 *   picked는 오름차순, sections는 turnSection의 결과를 턴 순서대로
 */
export function sharedDocument({ sessionId, summary, picked, sections }) {
  const { turns, counts } = summary;
  const header = [
    "# your-call 공유 기록",
    "",
    `- 세션: ${sessionId}`,
    `- 기간: ${minute(turns[0]?.at)} ~ ${minute(turns.at(-1)?.at)}`,
    `- ⚑ 개입이 있는 턴: ${counts.interventionTurns} / ${counts.humanTurns} (사람 입력 턴)`,
    `- 원문을 공유한 턴: ${picked.length > 0 ? picked.join(", ") : "없음"}`,
    "- /your-call:share가 기록(.your-call/ledger)에서 만들었습니다. 입력 원문은 위 번호의 턴에만 있고, AI의 마지막 말과 위임 원문은 넣지 않습니다.",
  ];
  return `${[...header, ...sections.flatMap((section) => ["", section])].join("\n")}\n`;
}

/**
 * @typedef {{ header: string, chosen: string, rejected: string, ownAnswer: string | null, reason: string }} SharedChoice
 * @typedef {{ number: number, at: string, machine: boolean, intents: string[], choices: SharedChoice[], interrupts: string[], edits: string[] }} SharedTurn
 */

const TURN_HEADING = /^## (\d+)\. \[([^\]]*)\]( — (.*))?$/;
/** turnSection이 쓰는 줄 중 사실로 읽지 않아도 되는 것. 알아보기만 하고 넘어간다. */
const KNOWN_LINE = /^- (스킬|에이전트|막힌 쓰기): /;

/**
 * sharedDocument가 쓴 공유본을 다시 읽는다. 공유본은 사람이 고칠 수 있으므로 형식에 맞지 않는 줄은 추측하지 않고 수만 센다.
 * @param {string} markdown
 * @returns {{ turns: SharedTurn[], unreadable: number }}
 */
export function readShared(markdown) {
  /** @type {SharedTurn[]} */
  const turns = [];
  let unreadable = 0;
  /** @type {string | null} 원문 코드 블록 안이면 그 펜스 */
  let fence = null;
  for (const line of markdown.split("\n")) {
    const turn = turns.at(-1);
    if (fence !== null) {
      if (line === fence) fence = null;
      continue;
    }
    const heading = line.match(TURN_HEADING);
    if (heading) {
      turns.push({ number: Number(heading[1]), at: heading[2], machine: heading[4] === "기계가 넣은 형식", intents: [], choices: [], interrupts: [], edits: [] });
      continue;
    }
    // 첫 턴 앞은 머리말이다. 빈 줄과 앞 항목의 이어지는 줄("  ")은 형식대로다.
    if (!turn || line.trim() === "" || line.startsWith("  ")) continue;
    const opening = line.match(/^(`{3,})text$/);
    if (opening) fence = opening[1];
    else if (line.startsWith("- 의도: ")) turn.intents.push(line.slice("- 의도: ".length));
    else if (line.startsWith("- ⚑ ✋ 중단 (") && line.endsWith(")")) turn.interrupts.push(line.slice("- ⚑ ✋ 중단 (".length, -1));
    else if (line.startsWith("- 바꾼 파일: ")) turn.edits.push(...line.slice("- 바꾼 파일: ".length).split(", "));
    else if (line.startsWith("- ⚑ 선택 「") && line.includes("」")) turn.choices.push(readChoice(line));
    else if (!KNOWN_LINE.test(line)) unreadable++;
  }
  return { turns, unreadable };
}

/** @param {string} line "- ⚑ 선택 「제목」 · 질문: … · 고른 것: … · 이유: …" */
function readChoice(line) {
  const header = line.slice("- ⚑ 선택 「".length, line.indexOf("」"));
  /** @type {Map<string, string>} */
  const fields = new Map();
  for (const part of line.slice(line.indexOf("」") + 1).split(" · ")) {
    const colon = part.indexOf(": ");
    if (colon !== -1) fields.set(part.slice(0, colon).trim(), part.slice(colon + 2));
  }
  const ownAnswer = fields.get("직접 쓴 답");
  return {
    header,
    chosen: fields.get("고른 것") ?? "없음",
    rejected: fields.get("버린 것") ?? "없음",
    ownAnswer: ownAnswer === undefined ? null : ownAnswer,
    reason: fields.get("이유") ?? "(비어 있음)",
  };
}
