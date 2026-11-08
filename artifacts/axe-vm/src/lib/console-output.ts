export const MAX_CONSOLE_OUTPUT_LENGTH = 160_000;

export function appendConsoleOutput(
  current: string,
  incoming: string,
  maxLength = MAX_CONSOLE_OUTPUT_LENGTH,
): string {
  if (!incoming) return current;
  const combined = current + incoming;
  return combined.length > maxLength ? combined.slice(-maxLength) : combined;
}

export function decodeConsoleBytes(decoder: TextDecoder, bytes: Uint8Array): string {
  return decoder.decode(bytes, { stream: true });
}
