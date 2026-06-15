/**
 * 정부지원사업 사업계획서 도우미 — 진단 리드 컬렉터 + 보고서 메일러 (GAS + Gmail)
 * --------------------------------------------------------------
 * Next.js 서버(/api/lead/email, /api/plan/diagnose)에서 server-to-server 호출.
 *   (GAS 웹앱 URL은 서버 환경변수 GAS_DIAGNOSIS_URL 에만 두고 브라우저엔 노출 안 함)
 *
 * POST type:"email_capture" → 이메일+동의를 '진단리드' 시트에 upsert (이메일 기준)
 * POST type:"report"        → 약점요약 갱신 + 전체 보고서를 입력 이메일로 Gmail 발송
 *
 * 시트 컬럼:
 *   A 시각 · B 이메일 · C 개인정보동의(Y) · D 마케팅동의(Y/N)
 *   E 진단약점요약 · F 보고서발송(Y/N) · G 발송시각
 *
 * 배포:
 *   1) script.google.com → 새 프로젝트 (진단 리드 전용 스프레드시트에 연결 권장)
 *   2) 본 코드 붙여넣기
 *   3) (선택) [프로젝트 설정] → 스크립트 속성 REVIEW_TOKEN = (임의문자열)
 *      → Next.js 환경변수 GAS_TOKEN 에 같은 값 (외부 스팸 차단)
 *   4) [배포] → [새 배포] → 웹 앱 · 실행: 나 · 액세스: 모든 사용자
 *      (Gmail 발송 권한 승인 필요)
 *   5) 웹앱 URL → Vercel 환경변수 GAS_DIAGNOSIS_URL
 *
 * 발신 이메일은 이 스크립트를 실행하는 구글계정(MailApp)입니다.
 * // TODO: 확인필요 - 발신 표기명/회신주소(예림님 운영 메일)로 맞출지
 */

var SHEET_NAME = '진단리드';
var HEADER = ['시각', '이메일', '개인정보동의', '마케팅동의', '진단약점요약', '보고서발송', '발송시각'];
var FROM_NAME = '정부지원사업 사업계획서 도우미';

function verifyToken_(body) {
  var expected = PropertiesService.getScriptProperties().getProperty('REVIEW_TOKEN');
  if (!expected) return true; // 토큰 미설정 시 통과(권장하지 않음 — 끄지 말 것)
  // 앞뒤 공백 차이로 인한 불일치 방지(양쪽 trim 비교)
  var got = body && body._token != null ? String(body._token).trim() : '';
  return got === String(expected).trim();
}

function doPost(e) {
  var body = parsePayload_(e);
  if (!body || typeof body !== 'object') return jsonOk_({ ok: false, error: 'invalid_payload' });
  if (!verifyToken_(body)) return jsonOk_({ ok: false, error: 'invalid_token' });

  var email = String(body.email || '').trim().toLowerCase();
  if (!email) return jsonOk_({ ok: false, error: 'missing_email' });

  var sheet = getOrCreateSheet_();
  ensureHeader_(sheet);

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15 * 1000);

    if (body.type === 'report') {
      return handleReport_(sheet, email, body);
    }
    return handleCapture_(sheet, email, body);
  } catch (err) {
    console.error('[diagnosis doPost]', err && err.stack || err);
    return jsonOk_({ ok: false, error: 'internal' });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function doGet() {
  // 버전 표식: 배포가 최신(첨부 지원)인지 외부에서 GET으로 확인하기 위함
  return ContentService.createTextOutput('진단 리드 컬렉터 v2 (docx-attach) · POST only').setMimeType(ContentService.MimeType.TEXT);
}

// 이메일+동의 upsert
function handleCapture_(sheet, email, body) {
  var row = findRowByEmail_(sheet, email);
  var now = body.timestamp ? new Date(body.timestamp) : new Date();
  var privacy = (String(body.privacyConsent).toUpperCase() === 'Y') ? 'Y' : 'N';
  var marketing = (String(body.marketingConsent).toUpperCase() === 'Y') ? 'Y' : 'N';
  if (row === -1) {
    sheet.appendRow([now, email, privacy, marketing, body.weaknessSummary || '', 'N', '']);
  } else {
    sheet.getRange(row, 3).setValue(privacy);
    sheet.getRange(row, 4).setValue(marketing);
    if (body.weaknessSummary) sheet.getRange(row, 5).setValue(body.weaknessSummary);
  }
  return jsonOk_({ ok: true, mode: row === -1 ? 'created' : 'updated' });
}

// 약점요약 갱신 + 전체 보고서 Gmail 발송
function handleReport_(sheet, email, body) {
  var row = findRowByEmail_(sheet, email);
  var now = new Date();
  if (row === -1) {
    sheet.appendRow([now, email, 'Y', 'N', body.weaknessSummary || '', 'N', '']);
    row = sheet.getLastRow();
  } else if (body.weaknessSummary) {
    sheet.getRange(row, 5).setValue(body.weaknessSummary);
  }

  var report = String(body.fullReportText || '').trim();
  if (!report) return jsonOk_({ ok: false, sent: false, error: 'empty_report' });

  try {
    var mail = {
      to: email,
      name: FROM_NAME,
      subject: '📋 사장님 사업 진단 보고서 (정부지원 심사 관점)',
      body: report + '\n\n— ' + FROM_NAME
    };
    // Word(.docx) 첨부가 있으면 첨부 (Next 서버가 base64로 보냄)
    var docx = String(body.docxBase64 || '');
    if (docx) {
      var blob = Utilities.newBlob(
        Utilities.base64Decode(docx),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '사업진단보고서.docx'
      );
      mail.attachments = [blob];
    }
    MailApp.sendEmail(mail);
    sheet.getRange(row, 6).setValue('Y');
    sheet.getRange(row, 7).setValue(now);
    return jsonOk_({ ok: true, sent: true });
  } catch (err) {
    console.error('[sendEmail]', err);
    return jsonOk_({ ok: false, sent: false, error: 'mail_failed' });
  }
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

// 단독(standalone) 프로젝트에서도 동작: 시트에 바인딩돼 있으면 그걸 쓰고,
// 아니면 전용 스프레드시트를 자동 생성해 ID를 스크립트 속성에 저장(다음부턴 그걸 재사용).
function getSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* 삭제됐으면 새로 생성 */ }
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    props.setProperty('SHEET_ID', active.getId());
    return active;
  }
  var created = SpreadsheetApp.create('정부지원 진단리드');
  props.setProperty('SHEET_ID', created.getId());
  return created;
}

function getOrCreateSheet_() {
  var ss = getSpreadsheet_();
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

function findRowByEmail_(sheet, emailLower) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var emails = sheet.getRange(2, 2, last - 1, 1).getValues();
  for (var i = 0; i < emails.length; i++) {
    if (String(emails[i][0] || '').trim().toLowerCase() === emailLower) return i + 2;
  }
  return -1;
}

function jsonOk_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

// =============== 테스트 ===============
// ⚠️ 테스트할 때 받을 이메일을 여기 직접 적으세요. (운영에선 방문자가 입력한 이메일을 사용하므로 무관)
//    Session.getActiveUser().getEmail() 은 빈 문자열을 반환하는 경우가 많아 테스트가 조용히 실패합니다.
var TEST_EMAIL = '본인이메일@gmail.com';

function testCapture() {
  doPost({ postData: { contents: JSON.stringify({
    type: 'email_capture', email: TEST_EMAIL, privacyConsent: 'Y', marketingConsent: 'N'
  }) } });
}

function testReport() {
  Logger.log('보낼 대상 이메일: ' + TEST_EMAIL);
  var res = doPost({ postData: { contents: JSON.stringify({
    type: 'report', email: TEST_EMAIL,
    weaknessSummary: '판매 검증, 반복 구조',
    fullReportText: '📋 사장님 사업 진단 결과\n\n✅ 강점: ...\n\n⚠️ 보완 필요: ...\n\n💡 심사위원 관점: ...'
  }) } });
  Logger.log('결과: ' + res.getContent()); // {"ok":true,"sent":true} 면 정상
}

// 발송 기능만 단독 점검 (권한·스팸 확인용)
function testMailDirect() {
  MailApp.sendEmail({
    to: TEST_EMAIL,
    name: '정부지원사업 사업계획서 도우미',
    subject: '✅ 메일 발송 테스트',
    body: '이 메일이 오면 발송 기능 정상입니다.'
  });
  Logger.log('발송 시도 완료 → ' + TEST_EMAIL);
}
