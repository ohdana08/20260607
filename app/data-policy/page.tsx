import type { Metadata } from "next";
import { PolicyPage, Article } from "@/components/legal/PolicyPage";

export const metadata: Metadata = { title: "AI·첨부자료 처리 안내 | 정부지원사업 도우미" };

export default function DataPolicyPage() {
  return (
    <PolicyPage title="AI·첨부자료 처리 안내" updatedLabel="최종 수정일: 2026-09-01">
      <Article title="1. AI 처리 안내">
        <p>
          본 서비스는 유료 사업계획서의 인터뷰·근거 정리·전략 설계·문서 작성·수정을 위해
          이용자가 선택한 외부 AI 모델(Anthropic Claude 또는 OpenAI)을 사용합니다. 공개 웹
          출처 확인이 필요한 근거·경쟁정보 조사는 Anthropic의 공개 웹 검색 기능을 사용합니다.
        </p>
      </Article>

      <Article title="2. AI에 전달되는 정보의 범위">
        <ul className="list-disc space-y-1 pl-5">
          <li>인터뷰 과정에서 이용자가 입력한 사업정보</li>
          <li>이용자가 업로드한 공고문·양식 등에서 추출한 텍스트와 이미지</li>
          <li>전달되는 정보는 <b>공고 추천·진단·근거 확인·전략 설계·문서 생성과 수정 목적에만 사용됩니다.</b></li>
        </ul>
      </Article>

      <Article title="3. 처리 목적">
        <p>
          입력된 사업정보와 첨부자료는 공고 추천, 자격 진단, 사업계획서 작성 및 근거 검증을 위한
          목적으로만 AI에 전달·처리됩니다. 경쟁정보 검색어에는 대표자 이름·연락처·비공개 매출 등
          개인 또는 영업비밀을 넣지 않고, 사업 분야·고객·제품·지역과 같은 일반 정보만 사용합니다.
        </p>
      </Article>

      <Article title="4. 공개 웹 출처 확인">
        <ul className="list-disc space-y-1 pl-5">
          <li>로그인·유료 구독·본인인증이 필요 없는 공개 페이지 범위에서만 확인합니다.</li>
          <li>검색 결과는 최신성·출처 유형·주장 일치 여부를 확인하며, 경쟁 후보는 최대 5곳, 상세 비교는 가까운 2곳으로 제한합니다.</li>
          <li>문서에는 확인 가능한 경우 출처 URL과 확인일을 함께 표시합니다.</li>
          <li>공개 페이지라도 자동 확인이 제한되거나 이용조건이 불명확하면 검증된 사실로 사용하지 않습니다.</li>
        </ul>
      </Article>

      <Article title="5. 데이터 보관">
        <p>
          HWP 파일은 서버에서 텍스트를 추출하는 동안 일시 처리하며 파일 자체를 영구 저장하지 않습니다. 대화,
          추출 텍스트와 생성 결과는 이용자의 브라우저 저장소에 남을 수 있으며, 브라우저에서 대화를 삭제하거나
          사이트 데이터를 지우면 삭제됩니다. 유료 작성 과정의 근거팩·전략팩·최종 점검 기록은 문서의 사실성과
          수정 범위를 확인하기 위해 주문 단위로 최대 45일간 서버에 보관된 뒤 자동 삭제됩니다. 회원 탈퇴만으로
          브라우저의 로컬 기록이 자동 삭제되지는 않습니다.
        </p>
      </Article>

      <Article title="6. 이용자 확인 사항">
        <p>이용자는 허위 정보를 입력해서는 안 되며, AI가 생성한 문서의 사실·수치·증빙과 최신 공고 조건을 최종 확인할 책임이 있습니다.</p>
      </Article>

      <Article title="7. AI 생성물의 한계">
        <p>
          최종 Word는 필수 근거 점검과 이용자 확인을 거친 뒤 제공하지만 모든 사실의 정확성이나 정부지원사업
          선정을 보장하지 않습니다. 근거 충돌 또는 필수 데이터 부족이 남아 있으면 최종 Word 다운로드를 막고,
          이용자가 실제 자료를 추가·확인하도록 안내합니다.
        </p>
      </Article>

      <p className="pt-4 text-sm text-zinc-500">
        본 안내는 2026년 9월 1일부터 시행합니다.
      </p>
    </PolicyPage>
  );
}
