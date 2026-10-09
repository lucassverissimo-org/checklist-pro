export function detectList(text: string): string[] {
  const cleaned = text.replace(/\r\n?/g, "\n").trim();
  if (!/[\n;]/.test(cleaned)) return [];
  const items = cleaned
    .split(/[\n;]/)
    .map((line) =>
      line
        .trim()
        .replace(/^(?:[-*•–—]\s+|\d+[.)]\s+|\[[ xX]\]\s*)/, "")
        .trim(),
    )
    .filter(Boolean);
  return items.length >= 2 &&
    items.length <= 100 &&
    items.every((line) => line.length <= 2000)
    ? items
    : [];
}
