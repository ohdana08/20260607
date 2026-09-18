import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import { PDFDocument } from "pdf-lib";
import { Resvg } from "@resvg/resvg-js";
import { performanceModules } from "./helpers/performance-harness.mjs";

const presentation = performanceModules().load("lib/plan/presentation.ts");
const emptyEvidence = { sources: [] };
const normalizedClaim = (text, overrides = {}) => presentation.normalizePresentationClaims([
  { id: "claim", text, status: "stated", origin: "user", stageId: "validation", ...overrides },
], emptyEvidence)[0];

for (const text of [
  "고객 100명이 사용 중이다",
  "다운로드 5000건을 기록했다",
  "가입자 100명, 경쟁사 조사는 미정",
  "매출 100만원을 기록했다. 다음 고객군은 가설이다",
]) {
  test(`presentation requires evidence for unsupported outcomes: ${text}`, () => {
    const claim = normalizedClaim(text, { requiresEvidence: false });
    assert.equal(claim.status, "stated");
    assert.equal(claim.requiresEvidence, true);
    const report = presentation.reviewPresentationPack({ slides: [], qa: [], claimLedger: [claim], sourceCoverage: [] });
    assert.ok(report.issues.some((issue) => issue.issue.includes("현재 실적·수치에 확인 자료가 없습니다")));
  });
}

test("presentation preserves plain missing experience and explicit future plans", () => {
  for (const text of ["고객 검증은 아직 없음", "시장 규모는 미확인", "직접 제품을 비교한 경험이 있다", "본인은 엑셀 정리가 가능하다"]) {
    const claim = normalizedClaim(text, { status: "missing", requiresEvidence: true });
    assert.equal(claim.status, "stated", text);
    assert.equal(claim.requiresEvidence, false, text);
  }
  const plan = normalizedClaim("고객 5명을 인터뷰할 계획", { status: "plan", verificationPlan: "다음 달 인터뷰 답변을 기록" });
  assert.equal(plan.status, "plan"); assert.equal(plan.requiresEvidence, false);
  const hypothesis = normalizedClaim("가격 10000원은 가설이다", { assumption: "가격 가정", verificationPlan: "사용자 반응을 확인" });
  assert.equal(hypothesis.status, "hypothesis"); assert.equal(hypothesis.requiresEvidence, false);
});

test("a beginner exception cannot override missing external evidence", () => {
  const claim = normalizedClaim("시장 규모는 미확인", { origin: "external" });
  assert.equal(claim.status, "missing"); assert.equal(claim.requiresEvidence, true);
});

test("automatic repair clears the previous approval when re-review fails", async () => {
  const source = readFileSync(new URL("../components/chat/Chat.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("Chat.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "generateDraft") declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(declaration, "execute the actual UI generation function");
  const original = [{ heading: "문제 인식", content: "원래 사용자 설명. ".repeat(40) }];
  const repaired = [{ heading: "문제 인식", content: "수정된 사용자 설명. ".repeat(40) }];
  let review = null, currentDraft, audits = 0;
  const context = {
    selectedProgram: { title: "가상 공고", target: "", summary: "" }, drafting: false, admin: false, paid: true, code: "",
    planUserTurns: 8, PLAN_MIN_TURNS: 5, formToc: [], PLAN_SECTIONS: original, draft: { sections: original },
    messages: [], docSummary: "가상 양식", eligReqs: null, profile: null, provider: "claude", reviewDone: true,
    setPlanReview(value) { review = value; }, setDraft(value) { currentDraft = value; },
    setDrafting() {}, setCharts() {}, setGenerationStage() {}, setMessages() {}, setReviewOpen() {},
    formTocToPlanSections: () => null, organizeEvidenceAndStrategy: async () => ({ evidence: {}, strategy: {} }),
    buildRegionNotice: () => null, extractBusinessRegion: () => null, preferredRegionNoticeHeading: () => "문제 인식",
    splitDraftBatches: (items) => items.map((item) => [item]), planTextMessages: () => [], authedHeaders: async () => ({}),
    async auditDraftSections() {
      audits++;
      if (audits === 1) {
        review = { submissionReady: true, score: 90, issues: [{ canAutoFix: true, issue: "표현 보완" }] };
        return review;
      }
      return null;
    },
    fetch: async (url) => {
      assert.equal(url, "/api/plan/revise");
      return Response.json({ sections: repaired, degraded: false });
    },
    track() {}, refreshPlanStatus: async () => {},
  };
  const code = ts.transpileModule(`${declaration.getText(tree)}\nglobalThis.run = generateDraft;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, context);
  await context.run();
  assert.equal(audits, 2); assert.deepEqual(currentDraft.sections, repaired);
  assert.equal(review, null, "the repaired document must not retain the old approval");
});

const exportBullets = Array.from({ length: 5 }, (_, index) => `보존할 핵심 내용 ${index + 1}`);
const exportPack = {
  title: "내보내기 회귀 검사", qa: [],
  slides: [{ stageId: "vision", title: "다섯 가지 핵심", headline: "모든 항목이 파일에 남아야 합니다", bullets: exportBullets,
    speakerNotes: "검증용 대본", sourceNotes: [] }],
};
test("PPTX retains all five accepted bullets in visible slide content", async () => {
  const { buildPresentationPptxBuffer } = performanceModules({ mocks: { pptxgenjs: { default: PptxGenJS } } }).load("lib/plan/presentationExport.ts");
  const zip = await JSZip.loadAsync(await buildPresentationPptxBuffer(exportPack));
  const visible = await zip.file("ppt/slides/slide1.xml").async("string");
  for (const bullet of exportBullets) assert.ok(visible.includes(bullet), `missing visible bullet: ${bullet}`);
});
test("PDF renders all five accepted bullets instead of dropping the final two", async () => {
  const rendered = [];
  class CapturedResvg extends Resvg { constructor(svg, options) { rendered.push(svg); super(svg, options); } }
  const { buildPresentationPdfBuffer } = performanceModules({ mocks: {
    "@resvg/resvg-js": { Resvg: CapturedResvg },
    "pdf-lib": { PDFDocument: { async create() {
      const document = await PDFDocument.create(), addPage = document.addPage.bind(document);
      // The real library uses instanceof Array; bridge the VM's tuple into its realm.
      document.addPage = (size) => addPage(Array.from(size));
      return document;
    } } },
  } }).load("lib/plan/presentationExport.ts");
  const buffer = await buildPresentationPdfBuffer(exportPack);
  assert.equal(buffer.subarray(0, 4).toString(), "%PDF");
  for (const bullet of exportBullets) assert.ok(rendered.join("\n").includes(bullet), `missing rendered bullet: ${bullet}`);
});

test("presentation export ignores caller image bytes and embeds only server-rendered PNGs", async () => {
  const images = [], rendered = [];
  class CapturedPptx extends PptxGenJS {
    addSlide(...args) {
      const slide = super.addSlide(...args), addImage = slide.addImage.bind(slide);
      slide.addImage = (options) => { images.push(options); return addImage(options); };
      return slide;
    }
  }
  class CapturedResvg extends Resvg { constructor(svg, options) { rendered.push(svg); super(svg, options); } }
  const hostile = '</text><image href="https://invalid.example/a.heif"/>';
  const evidence = { sources: [{ id: "proof", verified: true }], gaps: [] };
  const strategy = { customer: hostile, diagrams: { tamSamSom: {
    tam: "100", sam: "50", som: "10", evidenceStatus: "verified", evidenceIds: ["proof"], sourceNote: hostile,
    png: "aWNucwAAAAA=", path: "https://invalid.example/a.jxl", svg: hostile,
  } } };
  const pack = { ...exportPack, slides: [{ ...exportPack.slides[0], stageId: "market", image: hostile }] };
  const route = performanceModules({ mocks: {
    pptxgenjs: { default: CapturedPptx }, "@resvg/resvg-js": { Resvg: CapturedResvg },
    "@/lib/auth/googleUser": { paidGoogleLoginGate: async () => null },
    "@/lib/plan/presentationAccess": { checkPresentationAccess: async () => ({ ok: true, admin: false, user: { id: "buyer" }, paid: { consentedAt: "2026-09-17" } }) },
    "@/lib/plan/artifacts": {
      getPresentationArtifact: async () => ({ pack, review: { exportReady: false }, sectionsDigest: "sections", evidenceDigest: "artifact", strategyDigest: "artifact" }),
      getAuditArtifact: async () => ({ sectionsDigest: "sections" }), getEvidencePack: async () => evidence,
      getStrategyPack: async () => strategy, planArtifactDigest: () => "artifact",
    },
    "@/lib/plan/presentationRevisions": { markFirstPresentationDelivery: async () => { throw new Error("Review-only export must not start the revision window"); } },
  } }).load("app/api/plan/presentation/export/route.ts");
  const response = await route.POST(new Request("https://release.invalid", { method: "POST", body: JSON.stringify({
    programId: "program-A", format: "pptx", charts: [{ key: "tamsamsom", png: "aWNucwAAAAA=", path: "https://invalid.example/a.icns" }],
    pack: { ...pack, image: "https://invalid.example/a.heif" },
  }) }));
  assert.equal(response.status, 200); assert.equal(images.length, 1);
  assert.equal(images[0].path, undefined); assert.ok(images[0].data.startsWith("data:image/png;base64,"));
  assert.equal(Buffer.from(images[0].data.split(",")[1], "base64").subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.ok(rendered.length > 0); assert.ok(rendered.every((svg) => !svg.includes("<image")), "untrusted chart text cannot add an SVG image resource");
  assert.ok(rendered.some((svg) => svg.includes("&lt;image")), "hostile source text was rendered as text");
  const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
  const media = Object.values(zip.files).filter((file) => !file.dir && file.name.startsWith("ppt/media/"));
  assert.equal(media.length, 1);
  assert.equal((await media[0].async("nodebuffer")).subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});

function bindingHarness(file, admin = false) {
  let binds = 0, budgets = 0, aiCalls = 0;
  const bindingArgs = [];
  const denied = () => Response.json({}, { status: 402 });
  const access = { ok: true, admin, user: { id: "buyer" }, orderNo: "order-A", paid: { orderNo: "order-A", consentedAt: "2026-09-17" } };
  const evidence = { sources: [], gaps: [], competitors: [] };
  const strategy = { claims: [{ claim: "사용자 확인 계획", status: "plan", evidenceIds: [] }] };
  const bind = async (...args) => { binds++; bindingArgs.push(args); return false; };
  const budget = async () => { budgets++; return { ok: false }; };
  const loaded = performanceModules({ env: { ANTHROPIC_API_KEY: "synthetic-only" }, mocks: {
    "@/lib/auth/googleUser": { paidGoogleLoginGate: async () => null },
    "@/lib/config": { maintenanceGate: () => null },
    "@/lib/ratelimit": { checkRateLimit: async () => ({ ok: true }) },
    "@/lib/plan/paidAccess": { checkDraftAccess: async () => access, markCreditUsed: bind, paymentRequiredResponse: denied },
    "@/lib/plan/presentationAccess": { checkPresentationAccess: async () => access, markPresentationCreditUsed: bind, presentationPaymentRequiredResponse: denied },
    "@/lib/plan/applicationGuard": { decideDraftApplication: () => ({ ok: true }) },
    "@/lib/plan/aiBudget": { reservePaidAiCall: budget, reservePresentationAiCall: budget, aiBudgetExceededResponse: () => Response.json({}, { status: 429 }) },
    "@/lib/plan/presentationRevisions": { reservePresentationRevision: async () => ({ ok: true, rollback: async () => {} }) },
    "@/lib/plan/artifacts": {
      getEvidencePack: async () => evidence, getStrategyPack: async () => strategy, getPresentationArtifact: async () => null,
      getAuditArtifact: async () => ({ sectionsDigest: "sections", evidenceDigest: "artifact", strategyDigest: "artifact" }),
      planSectionsDigest: () => "sections", planArtifactDigest: () => "artifact",
    },
    "@/lib/llm/provider": { parseProvider: () => "claude", isProviderConfigured: () => true, getLlm() { aiCalls++; throw new Error("AI must not run"); } },
    "@/lib/llm/research": { async researchJson() { aiCalls++; throw new Error("AI must not run"); } },
  } }).load(file);
  const body = { program: { id: "program-A", title: "가상 공고" }, documentConfirmed: true, progress: {},
    messages: [{ role: "user", content: "실제 호출 없는 검증 입력" }], sections: [{ heading: "문제 인식", content: "검증 본문 ".repeat(60) }] };
  return { async run() { return loaded.POST(new Request("https://release.invalid", { method: "POST", body: JSON.stringify(body) })); },
    bindingArgs, get binds() { return binds; }, get budgets() { return budgets; }, get aiCalls() { return aiCalls; } };
}
for (const file of ["app/api/plan/evidence/route.ts", "app/api/plan/draft-batch/route.ts", "app/api/plan/presentation/chat/route.ts", "app/api/plan/presentation/generate/route.ts"]) {
  test(`paid AI cannot start when atomic credit binding fails: ${file}`, async () => {
    const h = bindingHarness(file);
    assert.equal((await h.run()).status, 402); assert.equal(h.binds, 1);
    assert.deepEqual(h.bindingArgs, [["buyer", "program-A", "order-A"]]);
    assert.equal(h.budgets, 0); assert.equal(h.aiCalls, 0);
  });
  test(`administrator verification does not mutate credit bindings: ${file}`, async () => {
    const h = bindingHarness(file, true);
    assert.equal((await h.run()).status, 429); assert.equal(h.binds, 0); assert.equal(h.budgets, 1);
    assert.equal(h.aiCalls, 0);
  });
}

function prestageHarness() {
  const values = new Map(), expires = new Map(); let now = 0, fail = true, attempts = 0, stored = 0, finalizeFails = false;
  let pendingInsert = null;
  const optionsSeen = [];
  class Redis {
    async get(key) { if ((expires.get(key) ?? Infinity) <= now) { values.delete(key); expires.delete(key); } return values.get(key) ?? null; }
    async set(key, value, options) {
      optionsSeen.push(options);
      if (options.nx && await this.get(key) !== null) return null;
      values.set(key, value); expires.set(key, now + options.px); return "OK";
    }
    async eval(script, [key], [token, completedAt]) {
      if (finalizeFails && completedAt !== undefined) throw new Error("synthetic Redis outage");
      if (await this.get(key) !== token) return 0;
      if (script.includes("'DEL'")) { values.delete(key); expires.delete(key); return 1; }
      values.set(key, completedAt); expires.delete(key); return 1;
    }
  }
  const loaded = performanceModules({ env: { UPSTASH_REDIS_REST_URL: "https://release.invalid", UPSTASH_REDIS_REST_TOKEN: "synthetic-only" },
    globals: { console: { error() {}, warn() {} } }, mocks: {
      "@upstash/redis": { Redis }, "@/lib/ratelimit": { checkRateLimit: async () => ({ ok: true }) },
      "@/lib/plan/paidAccess": { getAuthedUser: async () => ({ id: "buyer", email: "fixture@release.invalid" }) },
      "@/lib/supabase/admin": { createAdminClient: () => ({ from: () => ({ insert: () => ({ async abortSignal(signal) {
        assert.ok(signal); attempts++;
        if (pendingInsert) await pendingInsert;
        if (fail) return { error: { code: "08006", message: "synthetic outage" } };
        stored++; return { error: null };
      } }) }) }) },
    } });
  const route = loaded.load("app/api/lead/prestage/route.ts");
  return { values, optionsSeen, Redis, loaded, async run() { return route.POST(new Request("https://release.invalid")); },
    restore() { fail = false; }, block(promise) { pendingInsert = promise; }, advance(ms) { now += ms; }, failFinalize() { finalizeFails = true; },
    get attempts() { return attempts; }, get stored() { return stored; } };
}
test("prestage DB failure releases its reservation so recovery persists a lead", async () => {
  const h = prestageHarness(); assert.equal((await h.run()).status, 503);
  assert.equal(h.values.has("gp:prestage:buyer"), false);
  h.restore(); assert.equal((await h.run()).status, 200); assert.equal(h.stored, 1);
  assert.equal((await (await h.run()).json()).dup, true); assert.equal(h.stored, 1);
  assert.ok(h.optionsSeen.every((options) => options.nx && options.px === 30_000));
});
test("prestage in-flight work is retryable instead of a false duplicate success", async () => {
  const h = prestageHarness(); h.restore();
  let finish; h.block(new Promise((resolve) => { finish = resolve; }));
  const first = h.run();
  while (h.attempts === 0) await new Promise((resolve) => setImmediate(resolve));
  const second = await h.run(); assert.equal(second.status, 503); assert.equal(second.headers.get("retry-after"), "5");
  assert.equal(h.stored, 0); finish(); assert.equal((await first).status, 200); assert.equal(h.stored, 1);
});
test("prestage expired owners cannot release or finalize a replacement reservation", async () => {
  const h = prestageHarness(), store = new h.Redis();
  const { reservePrestage } = h.loaded.load("lib/leads/prestageReservation.ts");
  const old = await reservePrestage(store, "buyer"); h.advance(30_001);
  const replacement = await reservePrestage(store, "buyer"), token = h.values.get("gp:prestage:buyer");
  assert.equal(old.state, "reserved"); assert.equal(replacement.state, "reserved");
  await old.release(); assert.equal(await old.complete(), false);
  assert.equal(h.values.get("gp:prestage:buyer"), token);
  assert.equal(await replacement.complete(), true);
});
test("prestage acknowledges actual DB success while exposing failed dedup finalization", async () => {
  const h = prestageHarness(); h.restore(); h.failFinalize();
  const response = await h.run(); assert.equal(response.status, 200); assert.equal(h.stored, 1);
  assert.equal((await response.json()).deduplicationPending, true);
  assert.equal((await h.run()).status, 503, "an unfinalized pending marker must not pretend to be a completed duplicate");
});
