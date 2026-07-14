import type { Metadata } from "next";
import { PolicyPage, Article, Placeholder } from "@/components/legal/PolicyPage";

export const metadata: Metadata = { title: "환불정책 | 정부지원사업 도우미" };

export default function RefundPage() {
  return (
    <PolicyPage title="환불정책" updatedLabel="작성일: 2026-07-14">
      <Article title="1. 청약철회 및 환불의 원칙">
        <p>
          본 서비스는 전자상거래 등에서의 소비자보호에 관한 법률 제17조에 근거하여 청약철회를 지원합니다.
          다만 <b>이용 시작(초안 생성) 이후에는 청약철회 및 환불이 불가합니다.</b> 결제 즉시 AI 초안 생성이
          개시되어 서비스 제공이 시작되기 때문입니다.
        </p>
      </Article>

      <Article title="2. 결제 전 확인 기회 제공">
        <p>
          회사는 이용자가 결제 전 서비스 내용을 충분히 확인할 수 있도록 무료 자격 진단 및 결제 전 미리보기를
          제공합니다. 이용자는 결제 전 이 기능을 통해 서비스 적합성을 확인할 수 있습니다.
        </p>
      </Article>

      <Article title="3. 결제 전 동의 절차">
        <p>
          결제 진행 시 &ldquo;결제 즉시 초안 생성이 개시되어 환불이 불가함&rdquo;에 동의해야 하며, 동의 없이는
          결제가 진행되지 않습니다.
        </p>
      </Article>

      <Article title="4. 환불이 가능한 경우">
        <p>다음의 경우에는 예외적으로 환불이 가능합니다.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>회사의 시스템 오류로 인해 초안 생성이 실패한 경우</li>
          <li>결제는 완료되었으나 서비스가 정상적으로 제공되지 않은 경우</li>
        </ul>
      </Article>

      <Article title="5. 환불 절차">
        <p>
          환불이 필요한 경우 고객문의 채널을 통해 접수하며, 결제대행사(그로블)를 통해 처리됩니다. 환불 처리
          기간 및 방법은 결제대행사 정책을 따릅니다.
        </p>
      </Article>

      <Article title="6. 고지의 의무">
        <p>본 정책은 법령·정책 변경에 따라 개정될 수 있으며, 개정 시 서비스 내 공지를 통해 안내합니다.</p>
      </Article>

      <p className="pt-4 text-sm text-zinc-500">
        본 정책은 <Placeholder>[시행일자]</Placeholder>부터 시행합니다.
      </p>
    </PolicyPage>
  );
}
