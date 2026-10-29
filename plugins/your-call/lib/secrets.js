// serves: P7 — 커밋될 글에 토큰이 섞이는 것을 사람의 눈이 아니라 검사로 막는다. AI가 민감한지 판단하지 않는다.
// 찾은 문자열 자체는 돌려주지 않는다. 알림에 다시 찍히면 검사한 의미가 없다.

/** @type {Array<[kind: string, pattern: RegExp]>} */
const TOKEN_LIKE = [
  ["sk-", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["GitHub 토큰", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ["AKIA", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack 토큰", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["개인 키", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  // git 커밋 해시(40자)는 흔히 붙여 넣으므로 그보다 긴 것만 본다.
  ["긴 hex", /\b[0-9a-fA-F]{48,}\b/],
];

/**
 * @param {string} text
 * @returns {string[]} 찾은 종류. 없으면 빈 배열
 */
export function tokenLikeKinds(text) {
  return TOKEN_LIKE.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
}
