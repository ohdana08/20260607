import type { Metadata } from "next";
import { PolicyPage, Article } from "@/components/legal/PolicyPage";
import { BUNDLE_PRICE_LABEL, PRESENTATION_PRICE_LABEL, PRICE_LABEL } from "@/lib/config";
import { PLAN_OUTCOME_NOTICE, PLAN_REVISION_NOTICE } from "@/lib/plan/productPolicy";
import {
  PRESENTATION_OUTCOME_NOTICE,
  PRESENTATION_REVISION_NOTICE,
} from "@/lib/plan/presentationPolicy";

export const metadata: Metadata = { title: "이용약관 | 정부지원사업 도우미" };

export default function TermsPage() {
  return (
    <PolicyPage title="이용약관" updatedLabel="최종 수정일: 2026-09-02">
      <Article title="제1조 (목적)">
        <p>
          본 약관은 비즈니스커리어컨설팅(이하 &ldquo;회사&rdquo;)이 제공하는 정부지원사업 도우미 서비스(이하
          &ldquo;서비스&rdquo;)의 이용과 관련하여 회사와 이용자 간의 권리, 의무 및 책임사항을 규정함을 목적으로
          합니다.
        </p>
      </Article>

      <Article title="제2조 (정의)">
        <ol className="list-decimal space-y-1 pl-5">
          <li>&ldquo;서비스&rdquo;는 이용자가 입력한 사업정보와 확인된 근거를 정부지원사업 공고의 평가항목과 공식 양식에 맞춰 사업계획서(DOCX) 또는 선택한 발표자료(PPTX·PDF)로 작성하는 도구를 말합니다.</li>
          <li>&ldquo;이용자&rdquo;는 본 약관에 동의하고 서비스를 이용하는 회원을 말합니다.</li>
          <li>&ldquo;내부 초안&rdquo;이란 근거 보완과 모의심사 중 화면에 표시되는 문서를, &ldquo;최종본&rdquo;이란 필수 점검을 통과한 뒤 다운로드하는 DOCX·PPTX·PDF를 말합니다.</li>
        </ol>
      </Article>

      <Article title="제3조 (약관의 명시와 개정)">
        <ol className="list-decimal space-y-1 pl-5">
          <li>회사는 본 약관의 내용을 이용자가 알 수 있도록 서비스 초기 화면에 게시합니다.</li>
          <li>회사는 관련 법령을 위배하지 않는 범위에서 본 약관을 개정할 수 있으며, 개정 시 적용일자와 개정 사유를 명시하여 사전 공지합니다.</li>
        </ol>
      </Article>

      <Article title="제4조 (서비스의 내용)">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            회사는 다음의 서비스를 제공합니다.
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>정부지원사업 공고 자격 진단 (무료)</li>
              <li>근거·경쟁정보 확인 및 사업계획서 작성 (유료, 1건 {PRICE_LABEL})</li>
              <li>최초 최종본 DOCX 1회와 포함 범위의 묶음 AI 수정</li>
              <li>사업계획서 완성 후 발표자료 작성 (별도 선택, 1건 {PRESENTATION_PRICE_LABEL})</li>
              <li>사업계획서와 발표자료 묶음 상품 (선택, {BUNDLE_PRICE_LABEL})</li>
            </ul>
          </li>
          <li>이용자는 최종본을 내려받기 전에 사실관계, 수치, 증빙자료, 인용 출처와 공고의 최신 조건을 직접 확인해야 합니다.</li>
          <li><b>{PLAN_OUTCOME_NOTICE}</b></li>
          <li><b>{PRESENTATION_OUTCOME_NOTICE}</b></li>
        </ol>
      </Article>

      <Article title="제5조 (이용자의 의무)">
        <ol className="list-decimal space-y-1 pl-5">
          <li>이용자는 서비스 이용 시 정확한 정보를 입력해야 하며, 허위 정보 입력으로 발생하는 불이익은 이용자가 부담합니다.</li>
          <li>이용자는 타인의 정보를 도용하거나 서비스를 부정한 목적으로 이용해서는 안 됩니다.</li>
        </ol>
      </Article>

      <Article title="제6조 (유료 서비스 및 결제)">
        <ol className="list-decimal space-y-1 pl-5">
          <li>사업계획서 작성은 유료이며, 이용권 1건은 동일 공고·동일 사업아이템·동일 양식의 문서 1건에 사용됩니다.</li>
          <li>{PLAN_REVISION_NOTICE}</li>
          <li>발표자료는 사업계획서 상품과 별도이며, 발표자료 단품 또는 묶음 상품 결제 시에만 이용할 수 있습니다.</li>
          <li>{PRESENTATION_REVISION_NOTICE}</li>
          <li>결제는 그로블(Groble) 결제 시스템을 통해 이루어집니다.</li>
          <li>이용권 및 환불에 관한 세부사항은 별도의 환불정책을 따릅니다.</li>
        </ol>
      </Article>

      <Article title="제7조 (책임의 제한)">
        <ol className="list-decimal space-y-1 pl-5">
          <li>회사는 이용자가 서비스를 통해 작성한 문서의 내용과 정부지원사업 신청 결과를 보장하지 않으며, 이용자는 제출 전 사실과 증빙을 최종 확인해야 합니다.</li>
          <li>회사는 천재지변, 시스템 장애 등 불가항력으로 인한 서비스 중단에 대해 책임지지 않으며, 시스템 오류로 생성·수정에 실패한 호출은 수정 횟수로 차감하지 않습니다.</li>
        </ol>
      </Article>

      <Article title="제8조 (분쟁 해결)">
        <p>본 약관과 관련한 분쟁은 관련 법령 및 상관례에 따라 해결하며, 소송이 필요한 경우 회사 소재지 관할 법원을 관할로 합니다.</p>
      </Article>

      <Article title="제9조 (사업자 정보 및 고객문의)">
        <p>
          상호: 비즈니스커리어컨설팅(BCC) · 대표: 오예림 · 사업자등록번호: 153-15-01286
          <br />
          고객문의:{" "}
          <a href="https://open.kakao.com/o/gmPptFti" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
            BCC 카카오톡 고객문의
          </a>
        </p>
      </Article>

      <p className="pt-4 text-sm text-zinc-500">
        <b>부칙</b> — 본 약관은 2026년 9월 2일부터 시행합니다.
      </p>
    </PolicyPage>
  );
}
