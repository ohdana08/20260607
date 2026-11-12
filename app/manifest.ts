import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/discover", name: "딱, 지원핏 — 내게 맞는 지원사업", short_name: "딱지원핏",
    description: "내 조건에 맞는 지원사업과 새 공고 알림",
    start_url: "/discover?installed=1", scope: "/", display: "standalone", lang: "ko",
    background_color: "#f7f8fa", theme_color: "#163b32",
    icons: [192, 512].map(size => ({ src: `/pwa/icon-${size}.png`, sizes: `${size}x${size}`, type: "image/png", purpose: "any" })),
  };
}
