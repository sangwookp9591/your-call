// serves: P10 — 리뷰가 사람이 개입한 지점에서 시작되게, 기록을 턴으로 묶어 보여 준다. 사실을 먼저, AI의 말은 끝에 짧게.
// 판정하지 않는다. 숫자는 셈이고, 해석은 사람이 한다. 출력은 대화에 들어가므로 짧게 둔다 (P6).
//   node ledger-view.js       이번 세션 요약 + 최근 20턴
//   node ledger-view.js all   프로젝트 전체 요약 + 최근 세션 10개

import { isAbsolute, relative } from "node:path";
import { summarize } from "../lib/ledger-stats.js";
import { findProjectDir, listSessions, readEvents } from "../lib/ledger.js";
import { realLocation } from "../lib/real-path.js";

const RECENT_TURNS = 20;
const RECENT_SESSIONS = 10;
const SNIPPET = 80;

/** @typedef {ReturnType<typeof summarize>["counts"]} Counts */
/** @typedef {ReturnType<typeof summarize>["turns"][number]} Turn */

/** @param {string} text */
const clip = (text) => (text.length > SNIPPET ? `${text.slice(0, SNIPPET)}…` : text);
/** @param {number | null} rate */
const percent = (rate) => (rate === null ? "없음" : `${Math.round(rate * 100)}%`);
/** @param {unknown} ts */
const minute = (ts) => (typeof ts === "string" ? `${ts.slice(0, 16).replace("T", " ")}Z` : "시각 없음");
/** @param {unknown} labels */
const list = (labels) => (Array.isArray(labels) && labels.length > 0 ? labels.join(", ") : "없음");

/** @param {Counts} counts */
function summaryLines(counts) {
  const lines = [
    `- 사람 입력 ${counts.humanTurns}턴${counts.excludedTurns ? ` (기계가 넣은 형식이라 제외: ${counts.excludedTurns}턴)` : ""}`,
    `- ⚑ 개입이 있는 턴: ${counts.interventionTurns} / ${counts.humanTurns} (${percent(counts.interventionRate)})` +
      ` — 선택 ${counts.choices}회 (AI 추천 그대로 ${counts.choicesFollowingRecommendation}회, 직접 쓴 답 ${counts.choicesWithOwnAnswer}회)` +
      ` · 중단 ${counts.interrupts}회`,
    `- 의도를 밝힌 턴: ${counts.intentTurns} / ${counts.humanTurns} · 막힌 쓰기: ${counts.blocked}회`,
  ];
  if (counts.unattachedInterventions > 0) {
    lines.push(`- ⚠ 턴에 묶지 못한 ⚑ ${counts.unattachedInterventions}개 (prompt_id가 없는 기록이라 위 숫자에 들어가지 않았습니다)`);
  }
  return lines;
}

/**
 * 사실을 먼저 놓고, AI의 마지막 말은 맨 끝에 짧게 둔다.
 * @param {Turn} turn
 * @param {number} number
 * @param {string} projectDir
 */
function turnLines(turn, number, projectDir) {
  /** 프로젝트 안의 파일은 짧게 보여 준다. /var와 /private/var처럼 이름만 다른 같은 위치도 안으로 본다. */
  /** @param {string} path */
  const shortPath = (path) => {
    if (!isAbsolute(path)) return path;
    const inside = relative(realLocation(projectDir), realLocation(path));
    return inside.startsWith("..") ? path : inside;
  };
  const heading = `### ${number}. [${minute(turn.at)}] ${clip(turn.text.trimStart().split("\n")[0])}`;
  const lines = [turn.human ? heading : `${heading} — 기계가 넣은 형식, 셈에서 제외`];
  for (const intent of turn.intents) lines.push(`- 의도: ${String(intent.text).replaceAll("\n", "\n  ")}`);
  for (const choice of turn.choices) {
    const own = choice.other_text != null ? ` · 직접 쓴 답: "${clip(String(choice.other_text))}"` : "";
    lines.push(
      `- ⚑ 선택 「${choice.header ?? choice.question}」 고른 것: ${list(choice.chosen)} · 버린 것: ${list(choice.rejected)}${own}` +
        ` · 이유: ${choice.reason ?? "(비어 있음)"}`,
    );
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
  if (turn.lastMessage !== null) lines.push(`- 🤖 AI의 마지막 말: "${clip(turn.lastMessage.replaceAll("\n", " "))}"`);
  return lines;
}

/** @param {string} projectDir @param {string} sessionId */
function sessionView(projectDir, sessionId) {
  if (!listSessions(projectDir).includes(sessionId)) return ["이번 세션에는 아직 기록이 없습니다."];
  const { turns, counts } = summarize(readEvents(projectDir, sessionId));
  const firstShown = Math.max(turns.length - RECENT_TURNS, 0);
  return [
    "## 이번 세션 기록",
    ...summaryLines(counts),
    "",
    `## 최근 턴 (${turns.length - firstShown} / ${turns.length})`,
    ...turns.slice(firstShown).flatMap((turn, i) => ["", ...turnLines(turn, firstShown + i + 1, projectDir)]),
  ];
}

/** @param {string} projectDir */
function projectView(projectDir) {
  const sessions = listSessions(projectDir)
    .map((sessionId) => {
      const lines = readEvents(projectDir, sessionId);
      const start = lines.map((line) => String(line.ts ?? "")).filter(Boolean).sort()[0] ?? "";
      return { start, counts: summarize(lines).counts };
    })
    .sort((a, b) => b.start.localeCompare(a.start));
  if (sessions.length === 0) return ["아직 기록이 없습니다 (.your-call/ledger 폴더에 세션 기록이 없습니다)."];

  /** @type {Counts} 세션마다 따로 센 뒤 더한다. 세션 경계를 넘어 중단을 앞 턴에 붙이지 않기 위해서다. */
  const total = { ...sessions[0].counts };
  for (const key of /** @type {Array<keyof Counts>} */ (Object.keys(total))) {
    if (key !== "interventionRate") total[key] = sessions.reduce((sum, session) => sum + Number(session.counts[key]), 0);
  }
  total.interventionRate = total.humanTurns === 0 ? null : total.interventionTurns / total.humanTurns;

  const shown = sessions.slice(0, RECENT_SESSIONS);
  return [
    `## 프로젝트 전체 기록 (${sessions.length}개 세션)`,
    ...summaryLines(total),
    "",
    `## 최근 세션 (${shown.length} / ${sessions.length})`,
    ...shown.map(
      ({ start, counts }) =>
        `- ${minute(start)} · 사람 ${counts.humanTurns}턴 · ⚑ ${counts.interventionTurns}턴 (${percent(counts.interventionRate)}) · 의도 ${counts.intentTurns}턴`,
    ),
  ];
}

const projectDir = findProjectDir(process.cwd());
const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
const wantsAll = process.argv[2] === "all";

let output;
if (!wantsAll && !sessionId) output = ["세션을 알 수 없습니다 (CLAUDE_CODE_SESSION_ID가 없습니다). 기록을 보여 줄 수 없습니다."];
else if (!projectDir) output = ["아직 기록이 없습니다 (.your-call/ledger 폴더를 찾지 못했습니다)."];
else output = wantsAll ? projectView(projectDir) : sessionView(projectDir, String(sessionId));
console.log(output.join("\n"));
