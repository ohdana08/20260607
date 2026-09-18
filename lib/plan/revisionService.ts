import type { RevisionReservation, RevisionStatus } from "./revisionTypes";

interface DeliveryRecord {
  deliveredAt: string;
  expiresAt: string;
}

/** Only the storage operations required by revision accounting, not a generic repository. */
export interface RevisionStore {
  get<T>(key: string): Promise<T | null>;
  set(
    key: string,
    value: DeliveryRecord,
    options: { nx: true },
  ): Promise<unknown>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
}

interface RevisionPolicy {
  max: number;
  windowDays: number;
  deliveryKey: (orderNo: string) => string;
  countKey: (orderNo: string) => string;
}

interface RevisionDependencies {
  getPaidRecord: (userId: string) => Promise<{ orderNo: string } | null>;
  getStore: () => RevisionStore | null;
  now?: () => number;
}

/** Shared use case; wrappers retain product keys, entitlement lookup and HTTP messages.
 * Reservation ordering and failure behavior intentionally match the existing contract.
 * This extraction does not introduce distributed leases or automatic crash recovery.
 */
export function createRevisionService(
  policy: RevisionPolicy,
  deps: RevisionDependencies,
) {
  const now = deps.now ?? (() => Date.now());
  const emptyStatus = (): RevisionStatus => ({
    max: policy.max,
    used: 0,
    remaining: policy.max,
    deliveredAt: null,
    expiresAt: null,
    expired: false,
  });

  async function getStatus(
    userId: string,
    admin = false,
  ): Promise<RevisionStatus> {
    if (admin) return emptyStatus();
    const paid = await deps.getPaidRecord(userId);
    const store = deps.getStore();
    if (!paid || !store) return emptyStatus();
    const [delivery, rawUsed] = await Promise.all([
      store.get<DeliveryRecord>(policy.deliveryKey(paid.orderNo)),
      store.get<number>(policy.countKey(paid.orderNo)),
    ]);
    const used = Math.max(0, Math.min(policy.max, Number(rawUsed ?? 0)));
    const expired = Boolean(delivery && Date.parse(delivery.expiresAt) < now());
    return {
      max: policy.max,
      used,
      remaining: expired ? 0 : Math.max(0, policy.max - used),
      deliveredAt: delivery?.deliveredAt ?? null,
      expiresAt: delivery?.expiresAt ?? null,
      expired,
    };
  }

  async function markFirstDelivery(
    userId: string,
    admin = false,
  ): Promise<RevisionStatus> {
    if (admin) return emptyStatus();
    const paid = await deps.getPaidRecord(userId);
    const store = deps.getStore();
    if (!paid || !store) return emptyStatus();
    const deliveredAt = new Date(now());
    const expiresAt = new Date(
      deliveredAt.getTime() + policy.windowDays * 86400000,
    );
    await store.set(
      policy.deliveryKey(paid.orderNo),
      {
        deliveredAt: deliveredAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
      { nx: true },
    );
    return getStatus(userId);
  }

  async function reserve(
    userId?: string,
    admin = false,
  ): Promise<RevisionReservation> {
    const uncounted = (
      ok: boolean,
      status = emptyStatus(),
    ): RevisionReservation => ({
      ok,
      counted: false,
      status,
      rollback: async () => {},
    });
    if (admin || !userId) return uncounted(true);
    const paid = await deps.getPaidRecord(userId);
    const store = deps.getStore();
    if (!paid || !store) return uncounted(false);
    const before = await getStatus(userId);
    if (!before.deliveredAt) return uncounted(true, before);
    if (before.expired || before.remaining <= 0)
      return uncounted(false, before);
    const used = await store.incr(policy.countKey(paid.orderNo));
    if (used > policy.max) {
      await store.decr(policy.countKey(paid.orderNo));
      return uncounted(false, await getStatus(userId));
    }
    let settled = false;
    return {
      ok: true,
      counted: true,
      status: await getStatus(userId),
      async rollback() {
        if (settled) return;
        settled = true;
        await store.decr(policy.countKey(paid.orderNo));
      },
    };
  }

  return { getStatus, markFirstDelivery, reserve };
}
