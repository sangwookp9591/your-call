import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeProjectDir, readLedger, runHook } from "./helpers.js";

// 이 세션의 transcript에서 본 AskUserQuestion 결과 모양({questions, answers, annotations})을 따른 표본.
const timeSource = {
  question: "만료 기준 시간을 어디서 가져올까요?",
  header: "기준 시간",
  multiSelect: false,
  options: [
    { label: "서버 시간 (Recommended)", description: "모든 판정이 한 시계를 본다" },
    { label: "클라이언트 시간", description: "기기마다 다를 수 있다" },
  ],
};
const followUps = {
  question: "함께 처리할 것을 고르세요",
  header: "범위",
  multiSelect: true,
  options: [
    { label: "A안", description: "" },
    { label: "쉼표, 들어간 이름", description: "" },
    { label: "C안", description: "" },
  ],
};

/**
 * @param {Array<Record<string, unknown>>} questions
 * @param {Record<string, string>} answers
 * @param {Record<string, unknown>} [annotations]
 * @param {Record<string, unknown>} [overrides]
 */
const askResult = (questions, answers, annotations = {}, overrides = {}) =>
  JSON.stringify({
    session_id: "s-c",
    hook_event_name: "PostToolUse",
    tool_name: "AskUserQuestion",
    tool_use_id: "toolu_c",
    tool_input: { questions },
    tool_response: { questions, answers, annotations },
    ...overrides,
  });

/** @param {string} stdin */
function choicesFor(stdin) {
  const projectDir = makeProjectDir();
  const run = runHook("choice-capture", { stdin, projectDir });
  assert.equal(run.status, 0, run.stderr);
  if (!existsSync(join(projectDir, ".your-call", "ledger", "s-c.jsonl"))) return [];
  return readLedger(projectDir, "s-c").filter((line) => line.event === "choice");
}

test("C1: 질문마다 제시된 것, 고른 것, 버린 것, AI의 추천을 사실로 담은 choice 한 줄을 ⚑개입으로 남긴다", () => {
  const choices = choicesFor(askResult([timeSource, followUps], { [timeSource.question]: "서버 시간 (Recommended)", [followUps.question]: "C안" }));

  assert.equal(choices.length, 2);
  const { v, ts, session_id, ...first } = choices[0];
  assert.deepEqual(first, {
    prompt_id: null,
    event: "choice",
    by: "choice-capture",
    tool_use_id: "toolu_c",
    question: "만료 기준 시간을 어디서 가져올까요?",
    header: "기준 시간",
    multi_select: false,
    offered: [
      { label: "서버 시간 (Recommended)", description: "모든 판정이 한 시계를 본다" },
      { label: "클라이언트 시간", description: "기기마다 다를 수 있다" },
    ],
    recommended: ["서버 시간 (Recommended)"],
    chosen: ["서버 시간 (Recommended)"],
    rejected: ["클라이언트 시간"],
    other_text: null,
    notes: null,
    reason: null,
    intervention: true,
  });
  assert.deepEqual(choices[1].chosen, ["C안"]);
  assert.deepEqual(choices[1].recommended, []);
});

test("C2: 여러 개 고른 답은 선택지 이름과 맞춰 나누고, 이름에 쉼표가 있어도 맞게 나눈다", () => {
  const [choice] = choicesFor(askResult([followUps], { [followUps.question]: "A안, 쉼표, 들어간 이름" }));

  assert.deepEqual(choice.chosen, ["A안", "쉼표, 들어간 이름"]);
  assert.deepEqual(choice.rejected, ["C안"]);
  assert.equal(choice.other_text, null);
});

test("C3: 선택지 대신 직접 쓴 답은 other_text에 원문 그대로 남기고 모든 선택지를 버린 것으로 남긴다", () => {
  const typed = "  둘 다 아니고, 이번엔 제가 정할게요 ? ";

  const [choice] = choicesFor(askResult([timeSource], { [timeSource.question]: typed }));

  assert.deepEqual(choice.chosen, []);
  assert.deepEqual(choice.rejected, ["서버 시간 (Recommended)", "클라이언트 시간"]);
  assert.equal(choice.other_text, typed);
});

test("C8: 여러 개 고르기에서 선택지와 직접 쓴 답을 함께 내면 맞춰진 이름은 선택지 순서로 chosen, 나머지는 other_text에 원문 그대로 남긴다", () => {
  const desserts = {
    question: "디저트는 어떤 걸 드시겠어요? (여러 개 선택 가능)",
    header: "디저트",
    multiSelect: true,
    options: [{ label: "아이스크림" }, { label: "케이크" }, { label: "과일" }, { label: "커피" }],
  };

  // C7에서 대화형 세션으로 받은 실제 답
  const [choice] = choicesFor(askResult([desserts], { [desserts.question]: "커피, 과일,  케모마일 차 " }));

  assert.deepEqual(choice.chosen, ["과일", "커피"]);
  assert.deepEqual(choice.rejected, ["아이스크림", "케이크"]);
  assert.equal(choice.other_text, " 케모마일 차 ");
});

test("C4: 사람이 선택지에 단 메모는 notes에 원문 그대로 남긴다", () => {
  const annotations = { [timeSource.question]: { notes: "서버 시간이 맞지만 오프라인은 따로 보자" } };

  const [choice] = choicesFor(askResult([timeSource], { [timeSource.question]: "서버 시간 (Recommended)" }, annotations));

  assert.equal(choice.notes, "서버 시간이 맞지만 오프라인은 따로 보자");
});

test("C5: AI가 짐작해 채울 칸을 만들지 않는다 (reason은 항상 null, 의도 칸 없음)", () => {
  const choices = choicesFor(
    askResult([timeSource, followUps], { [timeSource.question]: "클라이언트 시간", [followUps.question]: "직접 쓴 이유가 있는 답" }),
  );

  assert.equal(choices.length, 2);
  for (const choice of choices) {
    assert.equal(choice.reason, null);
    assert.equal("intent" in choice, false);
  }
});

test("C6: AskUserQuestion이 아니거나 응답 모양이 다르면 기록하지 않고 작업을 막지 않는다", () => {
  const answered = { [timeSource.question]: "서버 시간 (Recommended)" };
  const notAsked = [
    askResult([timeSource], answered, {}, { tool_name: "Bash" }),
    askResult([timeSource], answered, {}, { tool_response: "문자열 응답" }),
    askResult([timeSource], answered, {}, { tool_response: { questions: [timeSource] } }),
    askResult([timeSource], answered, {}, { tool_input: { questions: "질문 아님" } }),
  ];
  for (const stdin of notAsked) {
    assert.deepEqual(choicesFor(stdin), [], stdin.slice(0, 120));
  }

  // 같은 실행 틀에서 올바른 입력은 기록된다: 위의 빈 결과가 hook이 돌지 않아서가 아님을 보인다.
  assert.equal(choicesFor(askResult([timeSource], answered)).length, 1);
});

test("C6: stdout에 쓰지 않고, 기록을 쓸 수 없으면 작업을 막지 않는 오류(exit 1)로 알린다", () => {
  const stdin = askResult([timeSource], { [timeSource.question]: "서버 시간 (Recommended)" });
  const projectDir = makeProjectDir();
  const quiet = runHook("choice-capture", { stdin, projectDir });
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(readLedger(projectDir, "s-c").length, 1);
  assert.equal(quiet.stdout, "");

  const readonly = makeProjectDir();
  const ledgerDir = join(readonly, ".your-call", "ledger");
  mkdirSync(ledgerDir, { recursive: true });
  chmodSync(ledgerDir, 0o500);
  try {
    const run = runHook("choice-capture", { stdin, projectDir: readonly });

    assert.equal(run.status, 1);
    assert.match(run.stderr, /EACCES/);
  } finally {
    chmodSync(ledgerDir, 0o700);
  }
});

test("C6: 한 번 실행하는 데 Node 기동을 포함해 200ms를 넘지 않는다 (5회 중앙값)", () => {
  const stdin = askResult([timeSource, followUps], { [timeSource.question]: "클라이언트 시간", [followUps.question]: "A안, C안" });
  const projectDir = makeProjectDir();
  const durations = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    const run = runHook("choice-capture", { stdin, projectDir });
    durations.push(performance.now() - started);
    assert.equal(run.status, 0, run.stderr);
  }

  assert.equal(readLedger(projectDir, "s-c").length, 10);
  const median = durations.sort((a, b) => a - b)[2];
  assert.ok(median < 200, `중앙값 ${median.toFixed(0)}ms`);
});
