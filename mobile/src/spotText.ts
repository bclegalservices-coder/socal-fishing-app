/** Nov 15: spot subtitles without the "· source: …" credit (older server copies and saved offline spots still have it). */
export function spotSub(s: string | null | undefined): string {
  return String(s ?? '').replace(/\s*·?\s*source:.*$/i, '').trim();
}
