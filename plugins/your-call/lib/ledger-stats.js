// serves: P10 — 기록 줄을 입력(턴)으로 묶고, 사람이 개입한 턴을 센다. 판정하지 않고 셈만 한다.
// 기록은 바꾸지 않는다. 기계가 넣은 입력을 빼는 것은 세는 방식에만 들어간다.

/** source 값만으로 기계가 넣은 턴임을 알 수 있는 경우 */
const MACHINE_SOURCES = ["system", "loop_wakeup", "schedule_wakeup", "poll_event"];
/** source가 비어 있어도 원문 형식으로 기계가 넣은 턴임을 알 수 있는 경우. 실제로 본 형식만 둔다. */
const MACHINE_PREFIXES = ["<agent-message"];

/**
 * @typedef {Record<string, any>} Line
 * @typedef {{
 *   promptId: string, at: string, text: string, human: boolean,
 *   intents: Line[], choices: Line[], interrupts: Line[], skills: Line[], agents: Line[], edits: Line[], blocked: Line[],
 *   lastMessage: string | null,
 * }} Turn
 */

/** @param {Line} prompt */
function isHuman(prompt) {
  if (MACHINE_SOURCES.includes(prompt.source)) return false;
  const text = String(prompt.text ?? "").trimStart();
  return !MACHINE_PREFIXES.some((prefix) => text.startsWith(prefix));
}

/** @param {Line} line */
function followsRecommendation(line) {
  const chosen = [...(line.chosen ?? [])].sort();
  const recommended = [...(line.recommended ?? [])].sort();
  return line.other_text === null && recommended.length > 0 && JSON.stringify(chosen) === JSON.stringify(recommended);
}

/**
 * @param {Line[]} lines 한 세션(또는 여러 세션)의 기록 줄
 */
export function summarize(lines) {
  /** @type {Map<string, Turn>} */
  const byPromptId = new Map();
  const prompts = lines
    .filter((line) => line.event === "prompt" && typeof line.prompt_id === "string")
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  for (const prompt of prompts) {
    if (byPromptId.has(prompt.prompt_id)) continue;
    byPromptId.set(prompt.prompt_id, {
      promptId: prompt.prompt_id,
      at: prompt.ts,
      text: String(prompt.text ?? ""),
      human: isHuman(prompt),
      intents: [], choices: [], interrupts: [], skills: [], agents: [], edits: [], blocked: [],
      lastMessage: null,
    });
  }
  const turns = [...byPromptId.values()];

  /** @type {Line[]} 어느 턴에도 묶지 못한 줄. 추측해서 붙이지 않고 수만 드러낸다. */
  const unattached = [];
  for (const line of lines) {
    const turn = byPromptId.get(line.prompt_id);
    if (!turn) {
      // session-open은 첫 입력 전이라 원래 prompt_id가 없다.
      if (line.event !== "session-open" && line.event !== "prompt") unattached.push(line);
      continue;
    }
    if (line.event === "interrupt") {
      // 중단은 다음 입력 때 발견된다. 실제로 끊긴 것은 바로 앞 턴이다.
      const index = turns.indexOf(turn);
      turns[Math.max(index - 1, 0)].interrupts.push(line);
    } else if (line.event === "intent") turn.intents.push(line);
    else if (line.event === "choice") turn.choices.push(line);
    else if (line.event === "skill") turn.skills.push(line);
    else if (line.event === "agent") turn.agents.push(line);
    else if (line.event === "edit") turn.edits.push(line);
    else if (line.event === "blocked") turn.blocked.push(line);
    else if (line.event === "turn-close" && typeof line.last_message === "string") turn.lastMessage = line.last_message;
  }

  const human = turns.filter((turn) => turn.human);
  const choices = human.flatMap((turn) => turn.choices);
  const interventionTurns = human.filter((turn) => turn.choices.length > 0 || turn.interrupts.length > 0).length;
  return {
    turns,
    counts: {
      humanTurns: human.length,
      excludedTurns: turns.length - human.length,
      interventionTurns,
      interventionRate: human.length === 0 ? null : interventionTurns / human.length,
      choices: choices.length,
      choicesFollowingRecommendation: choices.filter(followsRecommendation).length,
      choicesWithOwnAnswer: choices.filter((line) => line.other_text !== null && line.other_text !== undefined).length,
      interrupts: human.reduce((sum, turn) => sum + turn.interrupts.length, 0),
      intentTurns: human.filter((turn) => turn.intents.length > 0).length,
      blocked: human.reduce((sum, turn) => sum + turn.blocked.length, 0),
      unattached: unattached.length,
      unattachedInterventions: unattached.filter((line) => line.event === "choice" || line.event === "interrupt").length,
    },
  };
}
