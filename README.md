# your-call

> It's your call. AI가 선택지를 펼쳐 놓아도, 판단하고 책임지는 것은 사람이다.

결정을 대화 밖에 사실대로 남기고, 의도는 사람의 말로만 채우게 하는 Claude Code 플러그인입니다.

AI와 일하면 결정이 각자의 대화 안에서 일어나고, 다른 사람은 결과물만 봅니다. your-call은 그 대화에서 일어난 일(입력, 밝힌 의도, 선택지와 고른 것과 버린 것, 중단, 불러온 스킬, 위임, 바꾼 파일)을 hook이 사실 그대로 기록하게 합니다. AI는 그 기록을 쓸 수 없고, 의도나 이유를 짐작해 채우지 못합니다.

**상태**: 0.1.0 · 1단계(기록) 완료. 2단계(스펙: 통과 기준은 사람이, 테스트는 AI가)를 준비하고 있습니다.

## 설치

```
/plugin marketplace add sangwookp9591/your-call
/plugin install your-call@your-call
```

Node가 필요합니다. Claude Code 2.1.311, Node 22에서 확인했습니다.

## 쓰는 법

**의도는 사람이 먼저 밝힙니다.** 뒤에 남을 결정이라면 입력을 `why:`로 시작하세요. 빈 줄 전까지가 의도로 기록되고, 빈 줄 뒤에 지시를 이어 씁니다.

```
why: 만료 판정을 서버 시간 기준으로 통일
타임존 버그가 반복돼서

쿠폰 만료 로직 고쳐줘
```

| 명령 | 하는 일 |
|---|---|
| `/your-call:declare` | 이번 세션에 밝힌 의도를 보여 줍니다. 없으면 "무엇을, 왜"만 묻습니다. AI는 의도를 대신 쓰거나 예시를 만들지 않습니다. |
| `/your-call:ledger` | 이번 세션 기록을 입력 단위로 묶어 보여 줍니다. 사람이 개입한(⚑) 턴과 그 비율, 의도, 선택, 중단, 바꾼 파일. 사실이 먼저, 🤖 AI의 마지막 말은 맨 끝에 짧게. |
| `/your-call:ledger all` | 프로젝트의 모든 세션을 합친 요약과 최근 세션 10개. |

두 명령 모두 사람만 부를 수 있고, 기록을 읽기만 합니다.

## 무엇을 기록하나

`.your-call/ledger/<session_id>.jsonl`에 이벤트 하나가 한 줄로 쌓입니다. 모든 줄에는 같은 입력을 묶는 `prompt_id`가 있습니다.

| 줄 | 언제 | 남기는 것 |
|---|---|---|
| `session-open` | 세션이 시작될 때 | 시작 이유 (startup, resume, …) |
| `prompt` | 입력이 들어올 때 | 입력 원문 그대로 |
| `intent` | `why:`로 시작하는 사람의 입력 | 밝힌 의도 (사람의 말 그대로) |
| `interrupt` ⚑ | 사람이 Esc로 멈춘 뒤 다음 입력 때 | 응답 중 또는 도구 사용 중 |
| `choice` ⚑ | AI의 질문에 답했을 때 | 제시된 것, AI의 추천, 고른 것, 버린 것, 직접 쓴 답. 이유는 항상 비워 둡니다 |
| `skill` | 스킬을 불러왔을 때 | 이름, 사람이 불렀는지 AI가 불렀는지 |
| `agent` | AI가 에이전트에게 위임했을 때 | 종류, 설명, 위임 원문 |
| `edit` | `Write`, `Edit`, `NotebookEdit`로 파일을 바꿨을 때 | 경로만 (내용은 남기지 않습니다) |
| `turn-close` | 응답이 끝났을 때 | AI의 마지막 말 원문 |
| `blocked` | AI가 기록을 쓰려다 막혔을 때 | 도구와 경로 |

**기록은 기본적으로 커밋되지 않습니다.** 입력 원문이 그대로 들어가므로, 처음 기록할 때 `.your-call/.gitignore`에 `ledger/`를 넣습니다. 이미 있는 `.gitignore`는 건드리지 않습니다.

**AI는 기록을 쓸 수 없습니다.** `ledger-guard`가 `Write`, `Edit`, `NotebookEdit`로 `.your-call/ledger/` 아래를 쓰려는 호출을 막습니다. 상대 경로, `..`, 심볼릭 링크, `/var`와 `/private/var` 같은 실제 경로 차이, 대소문자 차이로 돌아 들어와도 막습니다. 사람은 에디터로 직접 고칠 수 있습니다.

## 알려진 빈틈

- **기계가 넣은 입력을 거르지 못할 수 있습니다.** `intent-capture`는 사람이 넣은 입력만 의도로 인정하려고 hook 입력의 `source`를 봅니다. 그런데 Claude Code 2.1.311에서는 `-p` 실행과 대화형 입력창 모두 이 값이 비어 있었고, 값이 없으면 사람의 입력으로 봅니다. 그래서 작업 알림 같은 기계가 넣은 턴이 `why:`로 시작하면 의도로 기록될 수 있습니다. Claude Code가 `source`를 보내면 그대로 걸러집니다.
  - 실제 사례: 백그라운드 에이전트가 결과를 돌려줄 때 Claude Code가 넣는 `<agent-message …>` 턴이 `source: null`인 `prompt` 줄로 기록됩니다. 기록은 들어온 사실 그대로 두고, `/your-call:ledger`가 셀 때만 이 형식을 사람 입력에서 빼고 뺀 수를 보여 줍니다.
- **`Bash`로 바꾼 파일은 `edit` 줄에 남지 않습니다.** 이때 AI의 마지막 말에는 바꿨다는 말이 있어도 `edit` 줄은 없을 수 있습니다.
- **`ledger-guard`는 `Write`, `Edit`, `NotebookEdit`만 봅니다.** `Bash`로 기록 파일에 직접 쓰는 우회는 막지 못합니다.
- **세션의 마지막 중단은 남지 않을 수 있습니다.** 중단은 다음 입력 때 transcript에서 찾기 때문에, 중단한 뒤 입력 없이 세션을 끝내면 기록되지 않습니다. transcript 형식은 Claude Code의 공식 계약이 아니라서, 형식이 바뀌면 중단이 기록되지 않을 수 있습니다.
- **두 명령은 문서에 없는 환경 변수 `CLAUDE_CODE_SESSION_ID`로 이번 세션을 찾습니다.** 이 값이 없으면 추측하지 않고 "세션을 알 수 없습니다"라고 말합니다.

## 출처

원칙은 윌비(여기어때 유저혜택개발팀)의 글 [「AI 시대 당신의 팀은 안녕하신가요」](https://techblog.gccompany.co.kr/ai-%EC%8B%9C%EB%8C%80-%EB%8B%B9%EC%8B%A0%EC%9D%98-%ED%8C%80-%EC%A1%B0%EC%A7%81%EC%9D%80-%EC%95%88%EB%85%95%ED%95%98%EC%8B%A0%EA%B0%80%EC%9A%94-c59f982d5add)에서 왔습니다.

- 원칙: [docs/PRINCIPLES.md](docs/PRINCIPLES.md)
- 설계도: [docs/architecture.html](docs/architecture.html)
- 작업 규칙: [CLAUDE.md](CLAUDE.md)

## 개발

```
npm install
npm run typecheck   # JS + JSDoc을 TypeScript 7이 strict로 검사
npm test            # 케이스마다 짝지은 테스트, 순서대로 실행
npm run test:e2e    # 실제 Claude Code 세션을 엶 (모델 호출 비용이 듦)
```

플러그인 코드는 빌드 없이 그대로 실행됩니다. 리뷰한 코드가 곧 실행되는 코드입니다.

## 라이선스

MIT
