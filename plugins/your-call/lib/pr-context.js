// serves: P10, P3, P9 — PR 본문 초안. 사실은 공유본에 있는 것만 옮기고, 작성자의 설명 칸은 비워 둔다.
// 리뷰어가 링크를 눌러 확인할 수 있는 것만 본문에 올라간다. ledger는 읽지 않는다.

/** @typedef {import("./share.js").SharedTurn} SharedTurn */
/**
 * @typedef {{ path: string, link: string | null, uncommitted: boolean, turns: SharedTurn[], unreadable: number }} SharedRecord
 *   path는 프로젝트 기준 상대 경로
 * @typedef {{ work: string, cases: Array<{ id: string, text: string }> }} WorkCases
 */

export const AUTHOR_START = "<!-- your-call:author-start -->";
export const AUTHOR_END = "<!-- your-call:author-end -->";

/** 사람이 채울 칸. 질문만 두고 답은 비워 둔다. */
export const EMPTY_AUTHOR_SECTION = [
  AUTHOR_START,
  "## 작성자 설명",
  "> 작성자가 직접 씁니다. 설명하지 못하는 곳이 있으면 그것도 그대로 적습니다.",
  "",
  "### 무엇을 왜",
  "",
  "### 장단점",
  "",
  "### 중간에 내린 판단",
  "",
  "### 자신 없는 곳",
  "",
  AUTHOR_END,
].join("\n");

const REVIEW_ORDER = [
  "## 리뷰 순서",
  "1. diff를 먼저 봅니다. 이 본문의 설명은 그다음에 읽습니다.",
  "2. 테스트를 읽습니다. 이름과 준비만으로 의도와 도메인 언어가 보이는지 봅니다.",
  "3. 기록은 ⚑ 개입 지점부터, 그다음 AI 혼자 판단한 곳을 봅니다.",
];

/** @param {string} path */
const sessionOf = (path) => path.replace(/^.*\//, "").replace(/\.md$/, "");

/**
 * @param {{ authorSection: string, shared: SharedRecord[], cases: WorkCases[] }} input
 *   authorSection은 AUTHOR_START부터 AUTHOR_END까지. 처음이면 EMPTY_AUTHOR_SECTION
 */
export function prDraft({ authorSection, shared, cases }) {
  const searched = `공유본 ${shared.length}개에서 찾음`;
  const interventions = shared.flatMap((record) => {
    const lines = record.turns.flatMap((turn) => [
      ...turn.choices.map((choice) => {
        const own = choice.ownAnswer === null ? "" : ` · 직접 쓴 답: ${choice.ownAnswer}`;
        return `- ${turn.number}번 턴 선택 「${choice.header}」 고른 것: ${choice.chosen} · 버린 것: ${choice.rejected}${own}`;
      }),
      ...turn.interrupts.map((kind) => `- ${turn.number}번 턴 ✋ 중단 (${kind})`),
    ]);
    return lines.length > 0 ? ["", `### ${sessionOf(record.path)}`, ...lines] : [];
  });
  const questions = shared.flatMap((record) =>
    record.turns.flatMap((turn) =>
      turn.choices
        .filter((choice) => choice.reason === "(비어 있음)")
        .map((choice) => {
          const picked = choice.chosen !== "없음" ? choice.chosen : `직접 쓴 답 ${choice.ownAnswer ?? ""}`;
          return `- ${sessionOf(record.path)} ${turn.number}번 턴 「${choice.header}」: 고른 것은 ${picked} — 이유가 비어 있습니다`;
        }),
    ),
  );
  const alone = shared.flatMap((record) =>
    record.turns
      .filter((turn) => turn.edits.length > 0 && turn.intents.length === 0 && turn.choices.length === 0 && turn.interrupts.length === 0)
      .map((turn) => `- ${sessionOf(record.path)} ${turn.number}번 턴: ${turn.edits.join(", ")}`),
  );
  const records = shared.map((record) => {
    const name = `\`${record.path}\``;
    const notes = [record.uncommitted ? " — 아직 커밋되지 않음" : "", record.unreadable > 0 ? ` — 읽지 못한 줄 ${record.unreadable}개` : ""].join("");
    return `- ${record.link ? `[${name}](${record.link})` : name}${notes}`;
  });
  const caseLines = cases.flatMap(({ work, cases: list }) => ["", `#### ${work}`, ...list.map(({ id, text }) => `- ${id}: ${text}`)]);

  return `${[
    "<!-- your-call:pr-context 초안. 작성자 설명 절 밖은 /your-call:pr-context가 공유본에서 다시 씁니다. -->",
    "",
    ...REVIEW_ORDER,
    "",
    authorSection,
    "",
    "## ⚑ 개입 지점",
    ...(interventions.length > 0 ? interventions : [`- 없음 (${searched})`]),
    "",
    "## 리뷰에서 물을 것",
    ...(questions.length > 0 ? questions : [`- 이유가 빈 선택 없음 (${searched})`]),
    "",
    "## AI 혼자 판단한 곳",
    "> 파일을 바꿨는데 의도도, 선택도, 중단도 없는 턴입니다. AI가 혼자 내린 판단이 들어 있을 수 있습니다.",
    ...(alone.length > 0 ? alone : [`- 없음 (${searched})`]),
    "",
    "## 기록과 확정 케이스",
    "",
    "### 공유본",
    ...records,
    "",
    "### 확정 케이스",
    ...(caseLines.length > 0 ? caseLines : ["- 이 브랜치에서 바뀐 cases.md 없음"]),
  ].join("\n")}\n`;
}
