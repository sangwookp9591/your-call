# your-call

> It's your call. AI가 선택지를 펼쳐 놓아도, 판단하고 책임지는 것은 사람이다.

결정을 대화 밖에 사실대로 남기고, 의도와 통과 기준은 사람이 정하게 하는 Claude Code 플러그인입니다.

**상태**: 개발 중 (0.1.0). 아직 컴포넌트가 없습니다.

## 설치

```
/plugin marketplace add sangwookp9591/your-call
/plugin install your-call@your-call
```

## 알려진 빈틈

- **기계가 넣은 입력을 거르지 못할 수 있습니다.** `intent-capture`는 사람이 넣은 입력만 의도로 인정하려고 hook 입력의 `source`를 봅니다. 그런데 Claude Code 2.1.311에서는 `-p` 실행과 대화형 입력창 모두 이 값이 비어 있었고, 값이 없으면 사람의 입력으로 봅니다. 그래서 작업 알림 같은 기계가 넣은 턴이 `why:`로 시작하면 의도로 기록될 수 있습니다. Claude Code가 `source`를 보내면 그대로 걸러집니다.
- **guard는 `Write`와 `Edit`만 봅니다** (예정). `Bash`로 기록 파일에 직접 쓰는 우회는 막지 못합니다.

## 출처

원칙은 윌비(여기어때 유저혜택개발팀)의 글 [「AI 시대 당신의 팀은 안녕하신가요」](https://techblog.gccompany.co.kr/ai-%EC%8B%9C%EB%8C%80-%EB%8B%B9%EC%8B%A0%EC%9D%98-%ED%8C%80-%EC%A1%B0%EC%A7%81%EC%9D%80-%EC%95%88%EB%85%95%ED%95%98%EC%8B%A0%EA%B0%80%EC%9A%94-c59f982d5add)에서 왔습니다.

- 원칙: [docs/PRINCIPLES.md](docs/PRINCIPLES.md)
- 설계도: [docs/architecture.html](docs/architecture.html)

## 라이선스

MIT
