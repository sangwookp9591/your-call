import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../plugins/your-call/lib/ledger-stats.js";

/** @param {string} promptId @param {string} ts @param {string} text @param {string | null} [source] */
const prompt = (promptId, ts, text, source = null) => ({ event: "prompt", prompt_id: promptId, ts, text, source });
/** @param {string} promptId @param {Record<string, unknown>} fields */
const choice = (promptId, fields) => ({
  event: "choice",
  prompt_id: promptId,
  question: "어느 쪽?",
  chosen: [],
  rejected: [],
  recommended: [],
  other_text: null,
  ...fields,
});

test("LS1: 줄을 prompt_id로 턴에 묶고, 턴은 prompt 줄의 시각 순으로 놓는다 (줄 순서와 무관)", () => {
  const events = [
    { event: "intent", prompt_id: "p2", text: "두 번째 의도" },
    prompt("p2", "2026-10-27T10:05:00.000Z", "why: 두 번째 의도"),
    { event: "session-open", prompt_id: null },
    prompt("p1", "2026-10-27T10:00:00.000Z", "첫 입력"),
    { event: "edit", prompt_id: "p1", file_path: "src/a.ts" },
    { event: "turn-close", prompt_id: "p2", last_message: "두 번째 끝" },
    { event: "skill", prompt_id: "p1", name: "dataviz", invoked_by: "ai" },
  ];

  const { turns } = summarize(events);

  assert.deepEqual(turns.map((turn) => turn.promptId), ["p1", "p2"]);
  assert.deepEqual(turns[0].edits.map((edit) => edit.file_path), ["src/a.ts"]);
  assert.deepEqual(turns[0].skills.map((skill) => skill.name), ["dataviz"]);
  assert.deepEqual(turns[1].intents.map((intent) => intent.text), ["두 번째 의도"]);
  assert.equal(turns[1].lastMessage, "두 번째 끝");
  assert.equal(turns[0].lastMessage, null);
});

test("LS2: 중단은 발견된 입력의 바로 앞 턴에 붙인다", () => {
  const events = [
    prompt("p1", "2026-10-27T10:00:00.000Z", "1부터 30까지 설명해줘"),
    prompt("p2", "2026-10-27T10:01:00.000Z", "계속"),
    { event: "interrupt", prompt_id: "p2", kind: "response", at: "2026-10-27T10:00:30.000Z" },
  ];

  const { turns } = summarize(events);

  assert.equal(turns[0].interrupts.length, 1);
  assert.equal(turns[1].interrupts.length, 0);
});

test("LS3: 기계가 넣은 입력은 사람 입력으로 세지 않고, 제외한 수를 따로 센다", () => {
  const events = [
    prompt("p1", "2026-10-27T10:00:00.000Z", "사람이 쓴 입력", "user"),
    prompt("p2", "2026-10-27T10:01:00.000Z", '<agent-message from="a9a5">\n[Subagent hand-back]'),
    prompt("p3", "2026-10-27T10:02:00.000Z", "작업 알림", "system"),
    prompt("p4", "2026-10-27T10:03:00.000Z", "루프", "loop_wakeup"),
    prompt("p5", "2026-10-27T10:04:00.000Z", "예약", "schedule_wakeup"),
    prompt("p6", "2026-10-27T10:05:00.000Z", "폴링", "poll_event"),
    prompt("p7", "2026-10-27T10:06:00.000Z", "/your-call:declare"),
    prompt("p8", "2026-10-27T10:07:00.000Z", "-p로 실행", "sdk"),
  ];

  const { turns, counts } = summarize(events);

  assert.deepEqual(turns.filter((turn) => turn.human).map((turn) => turn.promptId), ["p1", "p7", "p8"]);
  assert.equal(counts.humanTurns, 3);
  assert.equal(counts.excludedTurns, 5);
});

test("LS4: 개입률은 ⚑(선택 또는 중단)이 하나라도 있는 사람 입력 턴의 비율이다", () => {
  const events = [
    prompt("p1", "2026-10-27T10:00:00.000Z", "첫째"),
    choice("p1", { chosen: ["A"] }),
    choice("p1", { chosen: ["B"] }),
    prompt("p2", "2026-10-27T10:01:00.000Z", "둘째"),
    prompt("p3", "2026-10-27T10:02:00.000Z", "셋째"),
    { event: "interrupt", prompt_id: "p4", kind: "response" },
    prompt("p4", "2026-10-27T10:03:00.000Z", "넷째"),
    prompt("p5", "2026-10-27T10:04:00.000Z", "<agent-message>기계</agent-message>"),
    choice("p5", { chosen: ["A"] }),
  ];

  const { counts } = summarize(events);

  assert.equal(counts.humanTurns, 4);
  assert.equal(counts.interventionTurns, 2);
  assert.equal(counts.interventionRate, 0.5);
});

test("LS5: 선택, 추천 그대로 고른 선택, 직접 쓴 답, 중단, 의도를 밝힌 턴, 막힌 쓰기를 센다", () => {
  const events = [
    prompt("p1", "2026-10-27T10:00:00.000Z", "why: 통일\n\n고쳐줘"),
    { event: "intent", prompt_id: "p1", text: "통일" },
    { event: "intent", prompt_id: "p1", text: "같은 턴의 두 번째 의도 줄" },
    choice("p1", { recommended: ["서버 (Recommended)"], chosen: ["서버 (Recommended)"] }),
    choice("p1", { recommended: ["A (Recommended)"], chosen: ["B"] }),
    choice("p1", { recommended: [], chosen: [], other_text: "회덮밥" }),
    choice("p1", { recommended: ["A (Recommended)"], chosen: ["A (Recommended)"], other_text: "덧붙인 말" }),
    { event: "blocked", prompt_id: "p1", tool: "Write" },
    prompt("p2", "2026-10-27T10:01:00.000Z", "다음"),
    { event: "interrupt", prompt_id: "p2", kind: "tool-use" },
    prompt("p3", "2026-10-27T10:02:00.000Z", "그다음"),
    { event: "interrupt", prompt_id: "p3", kind: "response" },
  ];

  const { counts } = summarize(events);

  assert.equal(counts.choices, 4);
  assert.equal(counts.choicesFollowingRecommendation, 1);
  assert.equal(counts.choicesWithOwnAnswer, 2);
  assert.equal(counts.interrupts, 2);
  assert.equal(counts.intentTurns, 1);
  assert.equal(counts.blocked, 1);
});

test("LS7: 턴에 묶지 못한 줄의 수와 그중 ⚑ 줄의 수를 센다 (추측해서 붙이지 않는다)", () => {
  const events = [
    { event: "session-open", prompt_id: null },
    prompt("p1", "2026-10-27T10:00:00.000Z", "입력"),
    choice("p1", { chosen: ["A"] }),
    { event: "choice", question: "옛 기록", chosen: ["B"], other_text: null },
    { event: "interrupt", kind: "response" },
    { event: "edit", prompt_id: "없는-입력", file_path: "src/a.ts" },
  ];

  const { counts, turns } = summarize(events);

  assert.equal(counts.unattached, 3);
  assert.equal(counts.unattachedInterventions, 2);
  assert.equal(turns[0].choices.length, 1);
  assert.equal(counts.interventionTurns, 1);
});

test("LS6: 사람 입력이 0턴이면 개입률을 0으로 나누지 않고 없음(null)으로 둔다", () => {
  assert.equal(summarize([]).counts.interventionRate, null);
  assert.equal(summarize([prompt("p1", "2026-10-27T10:00:00.000Z", "<agent-message>기계</agent-message>")]).counts.interventionRate, null);

  // 같은 계산에서 사람 입력이 있으면 숫자가 나온다: 위의 null이 계산이 돌지 않아서가 아님을 보인다.
  assert.equal(summarize([prompt("p1", "2026-10-27T10:00:00.000Z", "사람")]).counts.interventionRate, 0);
});
