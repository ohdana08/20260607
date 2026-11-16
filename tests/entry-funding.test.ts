import test from "node:test";
import assert from "node:assert/strict";
import { isFundingNotice } from "../lib/entry/match.ts";
const p = (title: string, summary = "", target = "중소기업") => ({ id: "x", source: "kstartup", title, summary, target, supportField: "", region: "전국", applyEnd: null, url: "https://a.kr", formUrl: null }) as never;
test("money notices pass, classes and space do not", () => {
  assert.equal(isFundingNotice(p("[부산] 소상공인 에너지바우처 지급 공고")), true);
  assert.equal(isFundingNotice(p("2026 예비창업패키지 모집", "사업화 자금 최대 1억원")), true);
  assert.equal(isFundingNotice(p("[창업] 실패하지 않는 내 매장 자리 찾기", "강의")), false);
  assert.equal(isFundingNotice(p("마포 디자인 크리에이터 스쿨")), false);
  assert.equal(isFundingNotice(p("창업보육센터 입주기업 모집", "사무공간 지원")), false);
  assert.equal(isFundingNotice(p("소상공인 위기대응 특별 컨설팅 모집")), false);
});
