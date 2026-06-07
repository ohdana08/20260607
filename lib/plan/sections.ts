// 사업계획서 표준 항목(골격). K-Startup 등 정부지원사업의 일반 양식 기준.
// heading = 문서에 들어갈 격식 있는 제목, guide = 그 항목에 담을 내용(LLM용).
export interface PlanSection {
  key: string;
  heading: string;
  guide: string;
}

export const PLAN_SECTIONS: PlanSection[] = [
  {
    key: "overview",
    heading: "1. 창업 아이템 개요",
    guide: "어떤 제품/서비스인지, 한눈에 들어오게 요약. 무엇을 누구에게 어떻게 제공하는지.",
  },
  {
    key: "problem",
    heading: "2. 문제인식 (배경 및 필요성)",
    guide: "어떤 불편/문제를 해결하는지, 왜 지금 필요한지, 누가 겪는 문제인지(목표 고객).",
  },
  {
    key: "solution",
    heading: "3. 실현 가능성 (해결방안 및 차별성)",
    guide: "어떻게 해결하는지, 기존/경쟁 대비 차별점, 현재까지 진행한 것이나 실현 근거.",
  },
  {
    key: "growth",
    heading: "4. 성장 전략 (시장진입·사업화·자금계획)",
    guide: "어떻게 알리고 팔지, 어떻게 수익을 내는지, 받은 지원금/자금을 어디에 쓸지, 향후 1년 계획.",
  },
  {
    key: "team",
    heading: "5. 팀 구성 및 역량",
    guide: "대표자/팀의 강점과 이 사업을 해낼 수 있는 이유, 부족한 부분은 어떻게 보완하는지.",
  },
];
