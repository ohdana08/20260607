"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { analyticsAllowed, measurementIds, initializeAnalytics, safePageLocation, track } from "@/lib/ga";
import { captureUtm } from "@/lib/utm";

const subscribe = (notify: () => void) => {
  window.addEventListener("ddakfit-analytics-state", notify);
  return () => window.removeEventListener("ddakfit-analytics-state", notify);
};

// One loader for the configured stream. No tag is loaded on localhost/Preview.
export default function Analytics() {
  const pathname = usePathname();
  const allowed = useSyncExternalStore(subscribe, analyticsAllowed, () => false);
  const previous = useRef("");
  useEffect(() => {
    captureUtm();
    if (!allowed || !initializeAnalytics()) return;
    const page = safePageLocation();
    if (previous.current !== page) {
      previous.current = page;
      track("page_view");
    }
  }, [pathname, allowed]);

  const id = measurementIds()[0];
  if (!allowed || !id) return null;
  return <Script id="ddakfit-ga-loader" src={`https://www.googletagmanager.com/gtag/js?id=${id}`} strategy="afterInteractive" />;
}
