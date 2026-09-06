/**
 * Output comparison normalisation. Two programs that produce the "same answer"
 * modulo trailing whitespace and a trailing newline are treated as equal, so a
 * correct alternative implementation is never marked wrong on formatting alone.
 */
export function normalizeOutput(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n")
    .replace(/\n+$/u, "");
}

export function outputsMatch(actual: string, expected: string): boolean {
  return normalizeOutput(actual) === normalizeOutput(expected);
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
