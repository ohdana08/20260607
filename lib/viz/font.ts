import { existsSync } from "fs";
import { writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// 한글 폰트(Pretendard) — resvg가 한글 텍스트를 그리려면 필요.
// 배포 산출물에는 번들 폰트를 우선 사용한다. 이전 배포본과의 호환을 위해
// 번들 파일이 없는 경우에만 jsdelivr에서 받아 /tmp에 저장한다.
const FONT_URL =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static/Pretendard-Regular.otf";
const FONT_PATH = join(tmpdir(), "pretendard-regular.otf");
const BUNDLED_FONT_PATH = join(
  process.cwd(),
  "public",
  "fonts",
  "Pretendard-Regular.otf",
);

let pathPromise: Promise<string> | null = null;

export function getKoreanFontPath(): Promise<string> {
  if (!pathPromise) {
    pathPromise = (async () => {
      if (existsSync(BUNDLED_FONT_PATH)) return BUNDLED_FONT_PATH;
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
