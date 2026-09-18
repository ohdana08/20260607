# 딱지원핏

지원사업 탐색·신청 조건 확인·근거 기반 Word·발표자료 생성 서비스를 운영하는 Next.js 프로젝트입니다.

기능·비기능 요구사항, 사용자 흐름, 도메인, DB, API, 인증, 배포는 [시스템 설계](docs/architecture/README.md)에 정리했습니다.

모듈 경계·의존성·상태 관리·기술 부채와 단계별 개선은 [인수인계와 리팩터링](docs/architecture/handoff-refactor.md)을 참고하세요.

```bash
npm run check:architecture
npm run test:refactor
```

## 운영 화면 실행

```bash
npm ci
npm run dev:operations
```

http://127.0.0.1:3107/operations 에서 월 목표·날짜별 성과·영상 계획을 저장할 수 있습니다. 이 명령은 localhost 전용 파일 저장소를 사용하며 운영 데이터와 연결하지 않습니다. 실제 인증·Redis 사용과 배포는 [실행 안내](docs/architecture/runbook.md)를 참고하세요.

```bash
npm run test:operations
npm run test:guards
npm run build
```

## 기존 본체 실행

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
