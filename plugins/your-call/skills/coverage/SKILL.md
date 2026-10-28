---
name: coverage
description: 작업 하나의 확정 케이스와 테스트의 짝을 별도 컨텍스트의 case-coverage 에이전트에게 확인받고, 결과를 그대로 보여 준다.
argument-hint: "<작업 이름> [테스트 파일 경로...]"
disable-model-invocation: true
allowed-tools: Bash(node:*), Agent
---

<!-- serves: P14, P8, P12 — 짝 확인은 테스트를 쓴 대화 밖에서 한다. 이 스킬은 넘기고, 보여 주고, 물을 것만 묻는다. -->

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/spec-state.js" $ARGUMENTS`

입력: $ARGUMENTS

## 할 일

1. 위에 작업 이름이 없거나 쓸 수 없다고 나오면, 사람에게 작업 이름을 묻고 멈춘다.
2. `your-call:case-coverage` 에이전트에게 작업 이름과 테스트 파일 경로(입력의 두 번째 말부터)를 넘긴다. 경로가 없으면 없다고 넘긴다. 이 대화에서 짐작한 것(어느 테스트가 어느 케이스라는 생각)은 넘기지 않는다.
3. 에이전트의 결과를 고치거나 요약하지 않고 그대로 보여 준다.
4. 결과의 "사람에게 물을 것"만 사람에게 묻는다.

## 하지 않는 것

- 테스트를 쓰지 않고, 고치지도 않는다. 짝이 없는 케이스는 사람이 이어서 시킨다.
- cases.md를 쓰지 않는다.
- 결과를 판정하지 않는다. "충분하다", "거의 다 됐다"고 말하지 않는다.
