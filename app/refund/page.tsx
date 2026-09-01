import type { Metadata } from "next";
import { PolicyPage, Article } from "@/components/legal/PolicyPage";

export const metadata: Metadata = { title: "환불정책 | 정부지원사업 도우미" };

export default function RefundPage() {
  return (
    <PolicyPage title="환불정책" updatedLabel="최종 수정일: 2026-09-01">
      <Article title="1. 청약철회 및 환불의 원칙">
        <p>
          이용자는 관련 법령이 정한 기간과 요건에 따라 청약철회를 요청할 수 있습니다. 결제 후 아직 유료 맞춤
          작성 서비스를 시작하지 않았다면 고객문의 채널을 통해 청약철회를 요청할 수 있습니다.
        </p>
      </Article>

      <Article title="2. 유료 맞춤 작성 시작 이후">
        <p>
          주문 인증 후 이용자가 별도 고지에 동의하고 유료 맞춤 작성을 시작하면 개인화된 디지털콘텐츠 제공이
          개시됩니다. 이 시점 이후에는 관련 법령이 허용하는 범위에서 청약철회가 제한될 수 있습니다. 다만
          표시·광고 또는 계약내용과 다르게 제공된 경우에는 관련 법령에 따른 청약철회 권리가 유지됩니다.
        </p>
      </Article>

      <Article title="3. 결제 전 확인 기회와 동의">
        <p>
          회사는 결제 전에 무료 공고 추천, 자격 진단, 결과 미리보기와 유료 제공 범위를 제공합니다. 결제 전에는
          환불정책 확인을 받고, 주문 인증 후 유료 맞춤 작성을 시작하기 직전에는 청약철회 제한 가능성을 별도로
          고지하고 동의를 받습니다. 유료 제공 범위는 동일 공고·동일 사업아이템·동일 양식의 최초 최종 Word 1회와
          최초 최종본 제공일로부터 30일 이내 최대 3회의 묶음 AI 수정입니다.
        </p>
      </Article>

      <Article title="4. 환불이 가능한 경우">
        <p>다음의 경우에는 환불을 요청할 수 있습니다.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>유료 맞춤 작성 서비스가 아직 시작되지 않은 경우</li>
          <li>회사의 시스템 오류가 반복되어 최종본을 정상적으로 제공할 수 없는 경우</li>
          <li>결제는 완료되었으나 서비스가 정상적으로 제공되지 않은 경우</li>
          <li>표시·광고 또는 계약내용과 다르게 서비스가 제공된 경우</li>
        </ul>
      </Article>

      <Article title="5. 환불 절차">
        <p>
          환불 요청은{" "}
          <a href="https://open.kakao.com/o/gmPptFti" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
            BCC 카카오톡 고객문의
          </a>
          로 주문번호와 결제 이메일을 보내 접수합니다. 환불 승인 후 결제대행사(그로블)를 통해 처리하며, 실제
          결제 취소 반영 시점은 카드사·결제수단에 따라 달라질 수 있습니다.
        </p>
      </Article>

      <Article title="6. 고지의 의무">
        <p>본 정책은 법령·정책 변경에 따라 개정될 수 있으며, 개정 시 서비스 내 공지를 통해 안내합니다.</p>
      </Article>

      <p className="pt-4 text-sm text-zinc-500">
        본 정책은 2026년 9월 1일부터 시행합니다.
      </p>
    </PolicyPage>
  );
}
