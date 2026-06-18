export default function Maintenance() {
  return (
    <main className="flex min-h-[100dvh] flex-1 flex-col items-center justify-center bg-white px-6 text-center">
      <div className="max-w-md">
        <div className="text-5xl">🛠️</div>
        <h1 className="mt-5 text-2xl font-bold text-zinc-900">잠시 준비 중이에요</h1>
        <p className="mt-3 text-base leading-7 text-zinc-600">
          더 좋은 모습으로 만들기 위해 <b>리뉴얼 중</b>이에요.
          <br />
          곧 다시 열어드릴게요. 조금만 기다려 주세요! 🙏
        </p>
        <p className="mt-6 text-sm text-zinc-400">— 비즈니스커리어컨설팅(BCC)</p>
        <a
          href="https://pf.kakao.com/_xbrxjxkxj/chat"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-yellow-400 px-6 text-sm font-bold text-zinc-900 transition-colors hover:bg-yellow-300"
        >
          💬 오픈 알림 받기 (카카오톡)
        </a>
      </div>
    </main>
  );
}
