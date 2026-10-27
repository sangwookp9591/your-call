// serves: P7 — guard가 "이 경로가 그 폴더 안인가"를 우회 없이 판단하게 한다.
// 실제 위치(심볼릭 링크, /tmp → /private/tmp)로 바꾸고, 대소문자를 무시하고 비교한다.

import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";

/**
 * 아직 없는 파일이어도, 가장 가까운 존재하는 상위 폴더까지 실제 위치로 바꾼다.
 * @param {string} absolutePath
 */
export function realLocation(absolutePath) {
  const missing = [];
  let existing = absolutePath;
  while (!existsSync(existing) && dirname(existing) !== existing) {
    missing.unshift(basename(existing));
    existing = dirname(existing);
  }
  return join(realpathSync(existing), ...missing);
}

/**
 * macOS 기본 파일시스템은 대소문자를 구분하지 않으므로 비교도 구분하지 않는다.
 * @param {string} target 실제 위치
 * @param {string} dir 실제 위치
 */
export function isWithin(target, dir) {
  const t = target.toLowerCase();
  const d = dir.toLowerCase();
  return t === d || t.startsWith(d + sep);
}
