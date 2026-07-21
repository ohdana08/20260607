import type { Metadata } from "next";
import { PolicyPage, Article, Placeholder } from "@/components/legal/PolicyPage";

export const metadata: Metadata = { title: "개인정보처리방침 | 정부지원사업 도우미" };

export default function PrivacyPage() {
  return (
    <PolicyPage title="개인정보처리방침" updatedLabel="작성일: 2026-07-14">
      <Article title="1. 수집하는 개인정보 항목">
        <ul className="list-disc space-y-1 pl-5">
          <li>회원가입 시: 이름, 이메일, 전화번호</li>
          <li>결제 시: 주문번호 (카드번호 등 결제수단 정보는 회사가 저장하지 않으며, 결제대행사 그로블이 처리합니다)</li>
          <li>서비스 이용 시: 이용자가 입력한 사업정보, 업로드한 첨부파일(공고문·양식 등)</li>
          <li>자동 수집 정보: 서비스 이용 기록, 접속 로그</li>
        </ul>
      </Article>

      <Article title="2. 개인정보의 이용 목적">
        <ul className="list-disc space-y-1 pl-5">
          <li>회원 식별 및 서비스 제공(사업계획서 초안 생성, DOCX 다운로드)</li>
          <li>결제 및 이용권 관리</li>
          <li>서비스 개선 및 문의 대응</li>
        </ul>
      </Article>

      <Article title="3. 개인정보의 보유 및 이용 기간">
        <p>회원 탈퇴 시 즉시 파기함을 원칙으로 합니다. 다만 전자상거래 등에서의 소비자보호에 관한 법률에 따라 다음 정보는 명시된 기간 동안 보관합니다.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>계약 또는 청약철회 등에 관한 기록: 5년</li>
          <li>대금결제 및 재화 등의 공급에 관한 기록: 5년</li>
          <li>소비자의 불만 또는 분쟁처리에 관한 기록: 3년</li>
        </ul>
      </Article>

      <Article title="4. 개인정보의 제3자 제공">
        <p>회사는 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다. 다만 다음의 경우는 예외로 합니다.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>법령에 근거가 있거나 수사 목적으로 관계 기관의 요구가 있는 경우</li>
          <li>이용자가 사전에 동의한 경우</li>
          <li>서비스 제공을 위해 AI 처리가 필요한 경우, 입력된 사업정보 및 첨부자료가 처리 목적으로 Anthropic(Claude API)에 전달됩니다.</li>
        </ul>
      </Article>

      <Article title="5. 개인정보의 파기">
        <p>보유 기간이 경과하거나 처리 목적이 달성된 개인정보는 지체 없이 파기합니다. 전자적 파일 형태는 복구 불가능한 방법으로 영구 삭제합니다.</p>
      </Article>

      <Article title="6. 이용자의 권리">
        <p>이용자는 언제든지 자신의 개인정보를 조회, 수정, 삭제, 처리정지를 요청할 수 있으며, 회원탈퇴를 통해 개인정보 이용에 대한 동의를 철회할 수 있습니다.</p>
      </Article>

      <Article title="7. 개인정보 보호책임자">
        <p>
          개인정보 관련 문의는 아래 담당자에게 연락 바랍니다.
          <br />
          담당자: <Placeholder>[담당자명]</Placeholder>
          <br />
          연락처: <Placeholder>[이메일 / 전화번호]</Placeholder>
        </p>
      </Article>

      <Article title="8. 고지의 의무">
        <p>본 방침은 법령·정책 변경에 따라 개정될 수 있으며, 개정 시 서비스 내 공지를 통해 안내합니다.</p>
      </Article>

      <p className="pt-4 text-sm text-zinc-500">
        본 방침은 <Placeholder>[시행일자]</Placeholder>부터 시행합니다.
      </p>
    </PolicyPage>
  );
}
