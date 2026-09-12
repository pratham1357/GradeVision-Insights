/**
 * Minimal line-based diff for Evidence Replay: what changed between two
 * adjacent submission attempts. Longest-common-subsequence over lines; no
 * language awareness, no interpretation. Returns `null` when the inputs are
 * too large to diff cheaply - the caller then shows both versions as-is.
 */
export type DiffOp = { kind: "same" | "add" | "del"; text: string };

export interface LineDiff {
  ops: DiffOp[];
  added: number;
  removed: number;
}

/** Above this many line pairs the O(n*m) table is not worth building in the browser. */
const MAX_CELLS = 250_000;

function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  // A trailing newline should not read as an extra empty line.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function lineDiff(before: string, after: string): LineDiff | null {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length * b.length > MAX_CELLS) return null;

  // lcs[i][j] = length of the LCS of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const ops: DiffOp[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ kind: "del", text: a[i]! });
      removed++;
      i++;
    } else {
      ops.push({ kind: "add", text: b[j]! });
      added++;
      j++;
    }
  }
  while (i < a.length) {
    ops.push({ kind: "del", text: a[i++]! });
    removed++;
  }
  while (j < b.length) {
    ops.push({ kind: "add", text: b[j++]! });
    added++;
  }
  return { ops, added, removed };
}
