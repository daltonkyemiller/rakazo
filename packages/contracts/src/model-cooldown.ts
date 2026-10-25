/** Retry metadata preserved in the model SDK's rejected-delay diagnostic. */
export function modelCooldown(message: string) {
  const match = /server requested (\d+(?:\.\d+)?)s retry delay \(max:\s*(\d+(?:\.\d+)?)s\)/i.exec(
    message,
  );
  if (!match) return undefined;
  const requestedMs = Number(match[1]) * 1000;
  const maximumMs = Number(match[2]) * 1000;
  if (!Number.isSafeInteger(requestedMs) || !Number.isSafeInteger(maximumMs)) return undefined;
  if (requestedMs <= maximumMs || maximumMs < 0) return undefined;
  return { requestedMs, maximumMs };
}
