// serves: P10 — 사람이 AI를 멈춘 지점을 ⚑개입으로 남긴다.
// 중단을 알리는 hook 이벤트가 없어서, 다음 입력이 올 때 transcript에 새로 생긴 중단 표시를 찾는다.

import { capture } from "../lib/capture.js";
import { readState, writeState } from "../lib/ledger.js";
import { readNewLines } from "../lib/transcript.js";

/** @type {Map<unknown, "response" | "tool-use">} */
const MARKERS = new Map([
  ["[Request interrupted by user]", "response"],
  ["[Request interrupted by user for tool use]", "tool-use"],
]);

/**
 * @param {string} line transcript의 한 줄
 * @returns {{ kind: "response" | "tool-use", at: string | null, interruptedMessageId: string | null } | null}
 */
function interruptMarker(line) {
  if (!line.includes("Request interrupted by user")) return null;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  if (entry?.type !== "user") return null;

  const content = entry.message?.content;
  const text = typeof content === "string" ? content : content?.length === 1 && content[0]?.type === "text" ? content[0].text : null;
  const kind = MARKERS.get(text);
  if (!kind) return null;
  return {
    kind,
    at: typeof entry.timestamp === "string" ? entry.timestamp : null,
    interruptedMessageId: typeof entry.interruptedMessageId === "string" ? entry.interruptedMessageId : null,
  };
}

await capture((input, { projectDir, sessionId }) => {
  if (typeof input.transcript_path !== "string") return null;

  const state = readState(projectDir, sessionId, "interrupt");
  const read = readNewLines(input.transcript_path, typeof state.offset === "number" ? state.offset : 0);
  if (!read) return null;

  let lastAt = typeof state.lastAt === "string" ? state.lastAt : "";
  const entries = [];
  for (const line of read.lines) {
    const marker = interruptMarker(line);
    if (!marker) continue;
    // 처음부터 다시 읽을 때만 시각으로 걸러 낸다. 평소에는 읽은 위치가 중복을 막는다.
    if (read.restarted && marker.at !== null && marker.at <= lastAt) continue;
    entries.push({
      event: "interrupt",
      by: "interrupt-capture",
      kind: marker.kind,
      at: marker.at,
      interrupted_message_id: marker.interruptedMessageId,
      intervention: true,
    });
    if (marker.at !== null && marker.at > lastAt) lastAt = marker.at;
  }

  writeState(projectDir, sessionId, "interrupt", { offset: read.offset, lastAt });
  return entries;
});
