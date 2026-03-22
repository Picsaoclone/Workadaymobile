export function hexToRgba(hex: string, alpha: number): string {
  const normalizedAlpha = Math.min(1, Math.max(0, alpha));
  const value = hex.trim().replace('#', '');

  if (value.length === 3) {
    const r = parseInt(value[0] + value[0], 16);
    const g = parseInt(value[1] + value[1], 16);
    const b = parseInt(value[2] + value[2], 16);
    if ([r, g, b].some((channel) => Number.isNaN(channel))) return hex;
    return `rgba(${r}, ${g}, ${b}, ${normalizedAlpha})`;
  }

  if (value.length === 6) {
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    if ([r, g, b].some((channel) => Number.isNaN(channel))) return hex;
    return `rgba(${r}, ${g}, ${b}, ${normalizedAlpha})`;
  }

  return hex;
}
