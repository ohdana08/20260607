import type { Metadata } from "next";
import { PolicyPage, Article, Placeholder } from "@/components/legal/PolicyPage";

export const metadata: Metadata = { title: "AI·첨부자료 처리 안내 | 정부지원사업 도우미" };

export default function DataPolicyPage() {
  return (
    <PolicyPage title="AI·첨부자료 처리 안내" updatedLabel="작성일: 2026-07-14">
      <Article title="1. AI 처리 안내">
        <p>본 서비스는 사업계획서 초안 작성을 위해 Anthropic의 Claude API를 사용합니다.</p>
      </Article>

      <Article title="2. AI에 전달되는 정보의 범위">
        <ul className="list-disc space-y-1 pl-5">
          <li>인터뷰 과정에서 이용자가 입력한 사업정보</li>
          <li>이용자가 업로드한 공고문·양식 등 첨부자료</li>
          <li>전달되는 정보는 텍스트 정보에 한하며, <b>초안 생성 목적에만 사용되고 그 외 목적으로 사용되지 않습니다.</b></li>
        </ul>
      </Article>

      <Article title="3. 처리 목적">
        <p>입력된 사업정보와 첨부자료는 오직 이용자의 사업계획서 초안을 작성하기 위한 목적으로만 AI에 전달·처리됩니다.</p>
      </Article>

      <Article title="4. 데이터 보관">
        <p>입력 정보 및 첨부자료는 서비스 이용 기간 동안 보관되며, 회원 탈퇴 시 즉시 삭제됩니다.</p>
      </Article>

      <Article title="5. 이용자 확인 사항">
        <p>이용자는 허위 정보를 입력해서는 안 되며, AI가 생성한 초안의 내용을 최종 검토하고 보완할 책임이 있습니다.</p>
      </Article>

      <Article title="6. AI 생성물의 한계">
        <p>
          AI가 생성한 초안은 어디까지나 참고용 초안이며, 내용의 정확성이나 정부지원사업 합격을 보장하지
          않습니다. 확인이 필요한 항목은 <Placeholder>[확인 필요]</Placeholder> 또는{" "}
          <Placeholder>[증빙 필요]</Placeholder>로 표시되며, 이용자가 실제 자료로 검증·보완해야 합니다.
        </p>
      </Article>

      <p className="pt-4 text-sm text-zinc-500">
        본 안내는 <Placeholder>[시행일자]</Placeholder>부터 시행합니다.
      </p>
    </PolicyPage>
  );
}
