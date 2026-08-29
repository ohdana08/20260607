import type { Metadata } from "next";
import { PolicyPage, Article } from "@/components/legal/PolicyPage";

export const metadata: Metadata = { title: "AI·첨부자료 처리 안내 | 정부지원사업 도우미" };

export default function DataPolicyPage() {
  return (
    <PolicyPage title="AI·첨부자료 처리 안내" updatedLabel="최종 수정일: 2026-08-14">
      <Article title="1. AI 처리 안내">
        <p>본 서비스는 사업계획서 초안 작성을 위해 Anthropic의 Claude API를 사용합니다.</p>
      </Article>

      <Article title="2. AI에 전달되는 정보의 범위">
        <ul className="list-disc space-y-1 pl-5">
          <li>인터뷰 과정에서 이용자가 입력한 사업정보</li>
          <li>이용자가 업로드한 공고문·양식 등에서 추출한 텍스트와 이미지</li>
          <li>전달되는 정보는 <b>공고 추천·진단·초안 생성 목적에만 사용됩니다.</b></li>
        </ul>
      </Article>

      <Article title="3. 처리 목적">
        <p>입력된 사업정보와 첨부자료는 공고 추천, 자격 진단과 사업계획서 초안 작성을 위한 목적으로만 AI에 전달·처리됩니다.</p>
      </Article>

      <Article title="4. 데이터 보관">
        <p>
          HWP 파일은 서버에서 텍스트를 추출하는 동안 일시 처리하며 파일 자체를 영구 저장하지 않습니다. 대화,
          추출 텍스트와 생성 결과는 이용자의 브라우저 저장소에 남을 수 있으며, 브라우저에서 대화를 삭제하거나
          사이트 데이터를 지우면 삭제됩니다. 회원 탈퇴만으로 브라우저의 로컬 기록이 자동 삭제되지는 않습니다.
        </p>
      </Article>

      <Article title="5. 이용자 확인 사항">
        <p>이용자는 허위 정보를 입력해서는 안 되며, AI가 생성한 초안의 내용을 최종 검토하고 보완할 책임이 있습니다.</p>
      </Article>

      <Article title="6. AI 생성물의 한계">
        <p>
          AI가 생성한 초안은 어디까지나 참고용 초안이며, 내용의 정확성이나 정부지원사업 합격을 보장하지
          않습니다. 확인이 필요한 항목은 <strong>[확인 필요]</strong> 또는{" "}
          <strong>[증빙 필요]</strong>로 표시되며, 이용자가 실제 자료로 검증·보완해야 합니다.
        </p>
      </Article>

      <p className="pt-4 text-sm text-zinc-500">
        본 안내는 2026년 8월 14일부터 시행합니다.
      </p>
    </PolicyPage>
  );
}
