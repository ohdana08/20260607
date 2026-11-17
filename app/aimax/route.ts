import { NextRequest, NextResponse } from "next/server";

const TRACKING_PARAMS = {
  utm_source: "aimax",
  utm_medium: "partner",
  utm_campaign: "launch",
};

export function GET(request: NextRequest) {
  const destination = new URL("https://bccconsulting.kr/ddakfit/");

  Object.entries(TRACKING_PARAMS).forEach(([key, value]) => {
    destination.searchParams.set(key, value);
  });

  // Forward only explicit QA flags; never carry arbitrary data across domains.
  for (const key of ["qa", "bcc_analytics_debug"]) {
    if (request.nextUrl.searchParams.get(key) === "1") {
      destination.searchParams.set(key, "1");
    }
  }

  return NextResponse.redirect(destination, 302);
}
