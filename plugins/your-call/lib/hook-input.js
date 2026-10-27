// serves: P11 — 모든 hook이 같은 방식으로 Claude Code의 hook 입력(stdin JSON)을 읽는다.
// 실패해도 예외를 던지지 않는다. 실패했을 때 막을지 넘어갈지는 hook마다 정한다.

/**
 * @typedef {{ ok: true, value: Record<string, unknown> }
 *   | { ok: false, reason: "empty" | "invalid-json" | "not-object" }} HookInput
 */

/**
 * @param {string} raw
 * @returns {HookInput}
 */
export function parseHookInput(raw) {
  if (raw.trim() === "") return { ok: false, reason: "empty" };

  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "not-object" };
  }
  return { ok: true, value };
}

/**
 * @param {NodeJS.ReadableStream} [stream]
 * @returns {Promise<HookInput>}
 */
export async function readHookInput(stream = process.stdin) {
  stream.setEncoding("utf8");
  let raw = "";
  for await (const chunk of stream) raw += chunk;
  return parseHookInput(raw);
}
