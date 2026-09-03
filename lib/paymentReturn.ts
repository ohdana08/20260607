export const CHECKOUT_STARTED_KEY = "gp_checkout_started_v1";
export const CHECKOUT_MARK_TTL_MS = 2 * 60 * 60 * 1000;

interface StorageReader {
  getItem(key: string): string | null;
}

function isGrobleReferrer(referrer: string): boolean {
  if (!referrer) return false;
  try {
    const hostname = new URL(referrer).hostname.toLowerCase();
    return hostname === "groble.im" || hostname.endsWith(".groble.im");
  } catch {
    return false;
  }
}

export function isReturningFromPayment(args: {
  search: string;
  referrer?: string;
  storage?: StorageReader | null;
  now?: number;
}): boolean {
  const params = new URLSearchParams(args.search);
  if (params.get("payment") === "complete") return true;
  if (isGrobleReferrer(args.referrer ?? "")) return true;

  try {
    const checkoutAt = Number(args.storage?.getItem(CHECKOUT_STARTED_KEY) ?? 0);
    const now = args.now ?? Date.now();
    return checkoutAt > 0 && now - checkoutAt >= 0 && now - checkoutAt < CHECKOUT_MARK_TTL_MS;
  } catch {
    return false;
  }
}
