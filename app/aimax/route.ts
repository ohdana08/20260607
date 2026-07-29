import { NextRequest, NextResponse } from "next/server";

const TRACKING_PARAMS = {
  utm_source: "aimax",
  utm_medium: "partner",
  utm_campaign: "launch",
};

export function GET(request: NextRequest) {
  const destination = new URL("/landing", request.url);

  Object.entries(TRACKING_PARAMS).forEach(([key, value]) => {
    destination.searchParams.set(key, value);
  });

  request.nextUrl.searchParams.forEach((value, key) => {
    if (!key.startsWith("utm_")) destination.searchParams.set(key, value);
  });

  return NextResponse.redirect(destination, 302);
}
