declare module "pako" {
  export function inflate(
    input: Uint8Array | number[],
    options?: { windowBits?: number },
  ): Uint8Array;

  const pako: { inflate: typeof inflate };
  export default pako;
}
