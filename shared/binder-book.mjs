// Card-page numbers stay unchanged. The inside cover is a visual leaf only.
export function binderSpread(page, pages, spread = true, startOnRight = false) {
  const total = Math.max(1, pages), value = Math.max(0, Math.min(page, total - 1));
  const current = !spread ? value : startOnRight ? (value === 0 ? 0 : 1 + Math.floor((value - 1) / 2) * 2) : Math.floor(value / 2) * 2;
  const leadingBlank = spread && startOnRight && current === 0;
  const count = Math.min(spread && !leadingBlank ? 2 : 1, total - current);
  return { current, pages: Array.from({ length: count }, (_, i) => current + i), leadingBlank,
    trailingBlank: spread && !leadingBlank && count === 1,
    previous: current === 0 ? null : Math.max(0, current - (spread ? 2 : 1)),
    next: current + count < total ? current + count : null, last: current + count };
}
