/**
 * 정부지원사업 사업계획서 도우미 — 후기 컬렉터 (구글시트)
 * --------------------------------------------------------------
 * - Next.js 서버(/api/review)에서 server-to-server로 호출한다.
 *   (GAS Web App URL은 서버 환경변수 GAS_WEBHOOK_URL 에만 두고 브라우저엔 노출 안 함)
 * - POST: 후기 1건을 '후기' 시트에 append
 * - GET ?type=reviews: 공개 동의(Y) 후기 목록 + 전체 개수 반환 (홈페이지 노출용)
 *
 * 시트 컬럼:
 *   A 시각 · B 별점 · C 선택태그 · D 한줄평 · E 공개동의(Y/N) · F 사업분야 · G 이름
 *
 * 배포:
 *   1) script.google.com → 새 프로젝트(또는 후기 전용 스프레드시트에 연결)
 *   2) 본 코드 전체 붙여넣기
 *   3) (선택) [프로젝트 설정] → 스크립트 속성에 REVIEW_TOKEN = (임의 문자열) 추가
 *      → Next.js 환경변수 GAS_TOKEN 에 같은 값을 넣으면 외부 스팸 차단
 *   4) [배포] → [새 배포] → 유형 '웹 앱'
 *      · 실행: 나 · 액세스: 모든 사용자
 *   5) 발급된 웹앱 URL을 Vercel 환경변수 GAS_WEBHOOK_URL 에 등록
 *
 * ⚠️ 공개 노출은 '공개동의 = Y' 행만 됩니다. 사장님이 시트에서 직접
 *    공개 여부를 손보거나(Y/N 수정), 이름을 다듬을 수 있어요. (실명은 서버가 "김○○"로 마스킹)
 */

var SHEET_NAME = '후기';
var HEADER = ['시각', '별점', '선택태그', '한줄평', '공개동의(Y/N)', '사업분야', '이름'];

function verifyToken_(body) {
  var expected = PropertiesService.getScriptProperties().getProperty('REVIEW_TOKEN');
  if (!expected) return true; // 토큰 미설정 시 통과
  var got = body && body._token ? String(body._token) : '';
  return got === expected;
}

function doPost(e) {
  var body = parsePayload_(e);
  if (!body || typeof body !== 'object') return jsonOk_({ ok: false, error: 'invalid_payload' });
  if (!verifyToken_(body)) return jsonOk_({ ok: false, error: 'invalid_token' });

  var sheet = getOrCreateSheet_();
  ensureHeader_(sheet);

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15 * 1000);
    sheet.appendRow([
      body.timestamp || new Date().toISOString(),
      body.rating || '',
      body.tags || '',
      body.comment || '',
      (String(body.publicConsent).toUpperCase() === 'Y') ? 'Y' : 'N',
      body.bizField || '',
      body.name || ''
    ]);
    return jsonOk_({ ok: true });
  } catch (err) {
    console.error('[review doPost]', err && err.stack || err);
    return jsonOk_({ ok: false, error: 'internal' });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function doGet(e) {
  var type = e && e.parameter ? e.parameter.type : '';
  if (type !== 'reviews') {
    return ContentService.createTextOutput('후기 컬렉터 · GET ?type=reviews').setMimeType(ContentService.MimeType.TEXT);
  }
  // (선택) 토큰 검사
  var expected = PropertiesService.getScriptProperties().getProperty('REVIEW_TOKEN');
  if (expected) {
    var got = e.parameter._token || '';
    if (got !== expected) return jsonOk_({ count: 0, reviews: [] });
  }

  var sheet = getOrCreateSheet_();
  ensureHeader_(sheet);
  var last = sheet.getLastRow();
  if (last < 2) return jsonOk_({ count: 0, reviews: [] });

  var values = sheet.getRange(2, 1, last - 1, HEADER.length).getValues();
  var publicReviews = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var consent = String(r[4]).toUpperCase() === 'Y';
    if (!consent) continue;
    publicReviews.push({
      timestamp: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
      rating: Number(r[1]) || 0,
      tags: String(r[2] || ''),
      comment: String(r[3] || ''),
      bizField: String(r[5] || ''),
      name: String(r[6] || '')
    });
  }
  // 최신순
  publicReviews.sort(function (a, b) { return Date.parse(b.timestamp) - Date.parse(a.timestamp); });

  // count = 전체 후기 수(노출 게이트 기준), reviews = 공개 동의분만
  return jsonOk_({ count: values.length, reviews: publicReviews });
}

// =============== 헬퍼 ===============
function parsePayload_(e) {
  if (!e) return null;
  try {
    if (e.postData && typeof e.postData.contents === 'string') return JSON.parse(e.postData.contents);
    if (e.parameter && e.parameter.payload) return JSON.parse(e.parameter.payload);
  } catch (err) {
    console.warn('parsePayload_ failed', err);
  }
  return null;
}

function getOrCreateSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  return sheet;
}

function ensureHeader_(sheet) {
  var firstRow = sheet.getRange(1, 1, 1, HEADER.length).getValues()[0];
  var needs = false;
  for (var i = 0; i < HEADER.length; i++) {
    if (firstRow[i] !== HEADER[i]) { needs = true; break; }
  }
  if (needs) {
    sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
    sheet.setFrozenRows(1);
    var hr = sheet.getRange(1, 1, 1, HEADER.length);
    hr.setFontWeight('bold');
    hr.setBackground('#0a0a0a');
    hr.setFontColor('#C9A84C');
  }
}

function jsonOk_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

// =============== 테스트 ===============
function testReview() {
  doPost({ postData: { contents: JSON.stringify({
    type: 'review', timestamp: new Date().toISOString(), rating: 5,
    tags: '막막했는데 구조가 잡혔다, 빠르게 초안이 나왔다',
    comment: '진짜 큰 도움 됐어요', publicConsent: 'Y', bizField: '예비창업패키지 준비', name: '홍길동'
  }) } });
}
