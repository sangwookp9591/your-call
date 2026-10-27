// PC1용 테스트 hook: 줄이 직접 prompt_id를 넣는 경우.
import { capture } from "../../plugins/your-call/lib/capture.js";

await capture(() => ({ event: "test", by: "own-prompt-id", prompt_id: "from-line" }));
