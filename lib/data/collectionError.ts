export type CollectionFailureCode =
  | "NETWORK_ERROR" | "HTTP_ERROR" | "TIMEOUT" | "DEADLINE_EXCEEDED"
  | "SCHEMA_CHANGED" | "PAGE_LIMIT" | "INCOMPLETE_SNAPSHOT";

// Only bounded machine fields are logged. Never serialize response bodies, URLs,
// headers, credentials, or arbitrary exception messages into collector telemetry.
export class CollectionError extends Error {
  readonly code: CollectionFailureCode;
  readonly page: number;
  readonly status?: number;
  constructor(
    code: CollectionFailureCode,
    page: number,
    options: { cause?: unknown; status?: number } = {},
  ) {
    super(`EGBIZ ${code} at page ${page}`, { cause: options.cause });
    this.name = "CollectionError";
    this.code = code;
    this.page = page;
    this.status = options.status;
  }
}

const NETWORK_CODES = new Set([
  "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
]);

export function collectionErrorFields(error: unknown): Record<string, string | number> {
  const fields: Record<string, string | number> = { errorCode: "UNCLASSIFIED" };
  if (error instanceof CollectionError) {
    fields.errorCode = error.code;
    fields.page = error.page;
    if (error.status !== undefined) fields.httpStatus = error.status;
  }
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const item = current as { code?: unknown; name?: unknown; cause?: unknown };
    if (typeof item.code === "string" && NETWORK_CODES.has(item.code)) fields.networkCode = item.code;
    if (item.name === "TimeoutError" || item.name === "AbortError") fields.causeName = item.name;
    current = item.cause;
  }
  return fields;
}
