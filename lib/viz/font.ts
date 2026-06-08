import { existsSync } from "fs";
import { writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// 한글 폰트(Pretendard) — resvg가 한글 텍스트를 그리려면 필요.
// jsdelivr에서 1회 받아 /tmp에 저장하고, resvg에는 파일 경로로 넘긴다.
const FONT_URL =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static/Pretendard-Regular.otf";
const FONT_PATH = join(tmpdir(), "pretendard-regular.otf");

let pathPromise: Promise<string> | null = null;

export function getKoreanFontPath(): Promise<string> {
  if (!pathPromise) {
    pathPromise = (async () => {
      if (existsSync(FONT_PATH)) return FONT_PATH;
      const r = await fetch(FONT_URL, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`font fetch ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      await writeFile(FONT_PATH, buf);
      return FONT_PATH;
    })().catch((e) => {
      pathPromise = null; // 다음 호출에서 재시도
      throw e;
    });
  }
  return pathPromise;
}
