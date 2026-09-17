/** Product-independent revision state. Safe for browser and server type imports. */
export interface RevisionStatus {
  max: number;
  used: number;
  remaining: number;
  deliveredAt: string | null;
  expiresAt: string | null;
  expired: boolean;
}

export interface RevisionReservation {
  ok: boolean;
  counted: boolean;
  status: RevisionStatus;
  rollback: () => Promise<void>;
}
