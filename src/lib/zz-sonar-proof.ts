export function proofLabel(value: number): string {
  return value > 0 ? "positive" : value < 0 ? "negative" : "zero";
}
