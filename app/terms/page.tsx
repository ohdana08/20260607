import type { Metadata } from "next";
import { PolicyPage, Article } from "@/components/legal/PolicyPage";
import { PRICE_LABEL } from "@/lib/config";

export const metadata: Metadata = { title: "이용약관 | 정부지원사업 도우미" };

export default function TermsPage() {
  return (
    <PolicyPage title="이용약관" updatedLabel="최종 수정일: 2026-08-14">
      <Article title="제1조 (목적)">
        <p>
          본 약관은 비즈니스커리어컨설팅(이하 &ldquo;회사&rdquo;)이 제공하는 정부지원사업 도우미 서비스(이하
          &ldquo;서비스&rdquo;)의 이용과 관련하여 회사와 이용자 간의 권리, 의무 및 책임사항을 규정함을 목적으로
          합니다.
        </p>
      </Article>

      <Article title="제2조 (정의)">
        <ol className="list-decimal space-y-1 pl-5">
          <li>&ldquo;서비스&rdquo;는 이용자가 입력한 사업정보를 정부지원사업 공고의 평가항목과 공식 양식에 맞춰 사업계획서 초안(DOCX)으로 작성하는 도구를 말합니다.</li>
          <li>&ldquo;이용자&rdquo;는 본 약관에 동의하고 서비스를 이용하는 회원을 말합니다.</li>
          <li>&ldquo;초안&rdquo;이란 이용자의 입력 정보를 바탕으로 작성되는 사업계획서 문서를 말합니다.</li>
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
              <li>사업정보 기반 사업계획서 초안 작성 (유료, 1건 {PRICE_LABEL})</li>
              <li>작성된 초안 DOCX 다운로드</li>
            </ul>
          </li>
          <li>서비스가 작성하는 초안은 <b>사업계획서 작성의 출발점</b>이며, 이용자는 사실관계, 수치, 증빙자료, 공고의 최신 조건을 최종 확인하고 보완해야 합니다.</li>
          <li><b>회사는 정부지원사업의 선정 또는 합격을 보장하지 않습니다.</b></li>
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
          <li>초안 작성은 유료이며, 이용권 1건은 공고 1건에 대한 초안 작성에 사용됩니다.</li>
          <li>결제는 그로블(Groble) 결제 시스템을 통해 이루어집니다.</li>
          <li>이용권 및 환불에 관한 세부사항은 별도의 환불정책을 따릅니다.</li>
        </ol>
      </Article>

      <Article title="제7조 (책임의 제한)">
        <ol className="list-decimal space-y-1 pl-5">
          <li>회사는 이용자가 서비스를 통해 작성한 초안의 내용, 정부지원사업 신청 결과에 대해 책임지지 않습니다.</li>
          <li>회사는 천재지변, 시스템 장애 등 불가항력으로 인한 서비스 중단에 대해 책임지지 않으며, 시스템 오류로 초안 생성에 실패한 경우 이용권을 복구합니다.</li>
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
        <b>부칙</b> — 본 약관은 2026년 8월 14일부터 시행합니다.
      </p>
    </PolicyPage>
  );
}
