// serves: P10, P3, P9 — 이 브랜치의 공유본과 확정 케이스로 PR 본문 초안을 쓴다. 작성자 설명 칸은 사람의 것이라 비워 두고, 다시 써도 건드리지 않는다.
//   node pr-context.js          base는 main
//   node pr-context.js <base>
// 초안은 .your-call/pr/<브랜치>.md. 폴더 안의 .gitignore(*)로 커밋되지 않는다. PR은 사람이 만든다.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { AUTHOR_END, AUTHOR_START, EMPTY_AUTHOR_SECTION, prDraft } from "../lib/pr-context.js";
import { readShared } from "../lib/share.js";
import { readCases } from "../lib/spec.js";

/** @param {string} cwd @param {string[]} args @returns {string | null} 실패하면 null */
function git(cwd, ...args) {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  return run.status === 0 ? run.stdout.trim() : null;
}

/** @param {string | null} out */
const lines = (out) => (out ? out.split("\n").filter(Boolean) : []);

/** @param {string} startDir */
function findYourCallDir(startDir) {
  for (let dir = resolve(startDir); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".your-call"))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/** git@github.com:o/r.git, https://github.com/o/r(.git) */
const GITHUB_REMOTE = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/;

/** @param {string} base */
function run(base) {
  const cwd = process.cwd();
  if (git(cwd, "rev-parse", "--is-inside-work-tree") !== "true") return ["git 저장소가 아닙니다. PR 초안은 브랜치에서 바뀐 공유본으로 만듭니다."];
  const projectDir = findYourCallDir(cwd);
  if (!projectDir) return ["프로젝트 폴더(.your-call)를 찾지 못했습니다."];
  if (git(projectDir, "rev-parse", "--verify", "--quiet", `${base}^{commit}`) === null) return [`base(${base})를 찾지 못했습니다. /your-call:pr-context <base>로 다시 부르세요.`];
  const branch = git(projectDir, "rev-parse", "--abbrev-ref", "HEAD");
  if (!branch || branch === "HEAD") return ["지금 브랜치를 알 수 없습니다 (detached HEAD). 브랜치에서 다시 부르세요."];
  const forkPoint = git(projectDir, "merge-base", base, "HEAD");
  if (!forkPoint) return [`base(${base})와 갈라진 지점을 찾지 못했습니다.`];

  /** 갈라진 뒤 바뀐 파일(커밋, 스테이지, 작업 중) + 아직 git이 모르는 파일. 경로는 프로젝트 폴더 기준 */
  /** @param {string} pathspec */
  const changed = (pathspec) =>
    [...new Set([
      ...lines(git(projectDir, "diff", "--name-only", "--relative", forkPoint, "--", pathspec)),
      ...lines(git(projectDir, "ls-files", "--others", "--exclude-standard", "--", pathspec)),
    ])]
      .filter((path) => existsSync(join(projectDir, path)))
      .sort();

  const sharedPaths = changed(".your-call/shared").filter((path) => /^\.your-call\/shared\/[^/]+\.md$/.test(path));
  if (sharedPaths.length === 0) return [`base(${base})에서 갈라진 뒤 바뀐 공유본이 없습니다. 먼저 /your-call:share로 리뷰어에게 보일 공유본을 만드세요.`];

  const github = git(projectDir, "remote", "get-url", "origin")?.match(GITHUB_REMOTE);
  const prefix = git(projectDir, "rev-parse", "--show-prefix") ?? "";
  const shared = sharedPaths.map((path) => ({
    path,
    link: github ? `https://github.com/${github[1]}/${github[2]}/blob/${branch}/${prefix}${path}` : null,
    uncommitted: lines(git(projectDir, "status", "--porcelain", "--", path)).length > 0,
    ...readShared(readFileSync(join(projectDir, path), "utf8")),
  }));
  const cases = changed(".your-call/spec")
    .map((path) => path.match(/^\.your-call\/spec\/([^/]+)\/cases\.md$/)?.[1])
    .filter((work) => work !== undefined)
    .map((work) => ({ work, cases: readCases(projectDir, work) }));

  const prDir = join(projectDir, ".your-call", "pr");
  const relativePath = join(".your-call", "pr", `${branch.replaceAll("/", "-")}.md`);
  let authorSection = EMPTY_AUTHOR_SECTION;
  if (existsSync(join(projectDir, relativePath))) {
    const previous = readFileSync(join(projectDir, relativePath), "utf8");
    const start = previous.indexOf(AUTHOR_START);
    const end = previous.indexOf(AUTHOR_END);
    // 사람이 쓴 칸을 찾지 못하면 덮어써서 잃지 않게 멈춘다.
    if (start === -1 || end < start) return [`${relativePath}에서 작성자 설명 절의 표시를 찾지 못해 덮어쓰지 않았습니다. 파일을 옮기거나 지운 뒤 다시 부르세요.`];
    authorSection = previous.slice(start, end + AUTHOR_END.length);
  }

  mkdirSync(prDir, { recursive: true });
  if (!existsSync(join(prDir, ".gitignore"))) writeFileSync(join(prDir, ".gitignore"), "*\n");
  writeFileSync(join(projectDir, relativePath), prDraft({ authorSection, shared, cases }));
  return [
    `PR 초안을 썼습니다: ${relativePath}`,
    `- 공유본 ${shared.length}개, 확정 케이스가 바뀐 작업 ${cases.length}개 (base: ${base})`,
    "- 작성자 설명 절은 사람이 채웁니다. 채운 뒤 gh pr create --body-file로 PR을 만드세요.",
  ];
}

console.log(run(process.argv[2] ?? "main").join("\n"));
