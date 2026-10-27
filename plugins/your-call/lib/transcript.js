// serves: P10, P11 — transcript(대화 원본)에서 지난번에 읽은 곳 이후 새로 생긴 줄만 읽는다.
// transcript 형식은 Claude Code의 공식 계약이 아니다. 줄을 해석하는 쪽이 깨진 줄을 건너뛴다.

import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/**
 * @param {string} path
 * @param {number} offset 지난번에 읽은 끝 (바이트)
 * @returns {{ lines: string[], offset: number, restarted: boolean } | null} 파일을 열 수 없으면 null
 */
export function readNewLines(path, offset) {
  let fd;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const size = fstatSync(fd).size;
    const restarted = size < offset;
    const start = restarted ? 0 : offset;
    const chunk = Buffer.alloc(size - start);
    readSync(fd, chunk, 0, chunk.length, start);

    // 마지막 줄이 아직 쓰이는 중일 수 있다. 줄바꿈으로 끝난 데까지만 읽고, 나머지는 다음에 읽는다.
    const complete = chunk.lastIndexOf(0x0a) + 1;
    const lines = chunk.subarray(0, complete).toString("utf8").split("\n").filter((line) => line !== "");
    return { lines, offset: start + complete, restarted };
  } finally {
    closeSync(fd);
  }
}
