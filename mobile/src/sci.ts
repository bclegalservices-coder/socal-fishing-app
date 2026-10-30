// San Clemente Island Navy closures (Oct 28). Pure rules + the zone shapes — no screens — so they're tested.
//
// The waters out to 3 NM around San Clemente Island are a Coast Guard safety zone (33 CFR 165.1141) in 8 sections.
//   · Section G and Wilson Cove: restricted ALL THE TIME — get permission from FACSFAC San Diego first.
//   · Sections A–F: only closed while the Navy is training or testing (the rest of the time: fish normally).
// Who says what's closed: Admin → San Clemente (app_config "sci_closures"), set by hand from the Navy schedule /
// VHF / captains. The server sends the "now closed / reopened / closes tomorrow" pushes (api/sci/alerts.py).
// Corner points: eCFR § 165.1141 (checked Oct 28, 2026), degrees + decimal minutes.

export type SectionId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'W';
export type SectionState = { closed?: boolean; from?: string | null; until?: string | null };
export type SciClosures = { sections?: Partial<Record<SectionId, SectionState>>; note?: string | null; updated_at?: string | null };
export type Status = 'open' | 'closed' | 'scheduled' | 'permission';

export const FACSFAC_PHONE = '6195454742';
export const FACSFAC_PHONE_TEXT = '619-545-4742';
export const SCI_CENTER = { lat: 32.9, lon: -118.5 };
export const ALWAYS: SectionId[] = ['G', 'W'];
export const SWITCHABLE: SectionId[] = ['A', 'B', 'C', 'D', 'E', 'F'];

const dm = (d: number, m: number) => d + m / 60;
const P = (latD: number, latM: number, lonD: number, lonM: number): [number, number] => [-dm(lonD, lonM), dm(latD, latM)];

/** Polygon rings [lon, lat] in the order the regulation lists them. */
export const SECTIONS: Record<SectionId, { name: string; where: string; ring: [number, number][] }> = {
  A: { name: 'Section A', where: 'Northwest end · around Northwest Harbor', ring: [P(33, 2.05, 118, 35.85), P(33, 4.93, 118, 37.07), P(33, 2.82, 118, 30.65), P(33, 1.29, 118, 33.88)] },
  W: { name: 'Wilson Cove', where: 'Northeast side · Navy pier', ring: [P(33, 1.28, 118, 33.88), P(33, 2.82, 118, 30.65), P(32, 59.6, 118, 28.33), P(32, 57.3, 118, 30.88)] },
  B: { name: 'Section B', where: 'East side · north half', ring: [P(32, 57.3, 118, 30.88), P(32, 59.6, 118, 28.33), P(32, 55.83, 118, 24.22), P(32, 53.53, 118, 26.52)] },
  C: { name: 'Section C', where: 'East side · south half', ring: [P(32, 53.53, 118, 26.52), P(32, 55.83, 118, 24.22), P(32, 47.27, 118, 18.23), P(32, 49.1, 118, 21.05)] },
  D: { name: 'Section D', where: 'South end · Pyramid Cove / China Point', ring: [P(32, 49.1, 118, 21.05), P(32, 47.27, 118, 18.23), P(32, 48.38, 118, 31.69), P(32, 50.7, 118, 29.37)] },
  E: { name: 'Section E', where: 'West side · south', ring: [P(32, 50.7, 118, 29.37), P(32, 48.05, 118, 31.68), P(32, 53.62, 118, 35.93), P(32, 56.13, 118, 32.95)] },
  F: { name: 'Section F', where: 'West side · middle', ring: [P(32, 56.13, 118, 32.95), P(32, 53.62, 118, 35.93), P(32, 59.95, 118, 39.77), P(33, 1.08, 118, 36.33)] },
  G: { name: 'Section G', where: 'West side · north (always restricted)', ring: [P(33, 1.08, 118, 36.333), P(32, 59.95, 118, 39.77), P(33, 4.93, 118, 37.07), P(33, 2.05, 118, 35.85)] },
};

export function statusOf(id: SectionId, c: SciClosures | null | undefined, now: number): Status {
  if (ALWAYS.includes(id)) return 'permission';
  const s = c?.sections?.[id];
  if (!s?.closed) return 'open';
  const from = s.from ? Date.parse(s.from) : NaN, until = s.until ? Date.parse(s.until) : NaN;
  if (!isNaN(until) && now >= until) return 'open';                 // closure over: opens again by itself
  if (!isNaN(from) && now < from) return 'scheduled';
  return 'closed';
}

export const closedNow = (c: SciClosures | null | undefined, now: number) => SWITCHABLE.filter((id) => statusOf(id, c, now) === 'closed');
export const scheduled = (c: SciClosures | null | undefined, now: number) => SWITCHABLE.filter((id) => statusOf(id, c, now) === 'scheduled');

/** "4:00 PM" today, "Sat 6:00 AM" another day. */
export function whenText(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return new Date(now).toDateString() === d.toDateString() ? t : `${d.toLocaleDateString([], { weekday: 'short' })} ${t}`;
}

/** "A, B and D" */
export const listText = (ids: SectionId[]) => {
  const n = ids.map((i) => (i === 'W' ? 'Wilson Cove' : i));
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
};

/** One line for the map chip, or null when nothing is closed or coming up. */
export function summary(c: SciClosures | null | undefined, now: number): { text: string; level: 'closed' | 'soon' } | null {
  const on = closedNow(c, now);
  if (on.length) {
    const untils = on.map((id) => c?.sections?.[id]?.until).filter(Boolean) as string[];
    const last = untils.length === on.length ? untils.sort().slice(-1)[0] : null;
    return { text: `San Clemente: ${on.length === 6 ? 'all sections' : `Section${on.length > 1 ? 's' : ''} ${listText(on)}`} closed${last ? ` until ${whenText(last, now)}` : ''}`, level: 'closed' };
  }
  const up = scheduled(c, now).filter((id) => Date.parse(c!.sections![id]!.from!) - now < 24 * 3600e3);
  if (up.length) return { text: `San Clemente: Section${up.length > 1 ? 's' : ''} ${listText(up)} close ${whenText(c!.sections![up[0]]!.from!, now)}`, level: 'soon' };
  return null;
}

/** The map shapes, with each section's status for the colors. */
export function zonesGeoJSON(c: SciClosures | null | undefined, now: number) {
  return {
    type: 'FeatureCollection' as const,
    features: (Object.keys(SECTIONS) as SectionId[]).map((id) => ({
      type: 'Feature' as const,
      properties: { id, name: SECTIONS[id].name, status: statusOf(id, c, now), label: id === 'W' ? 'WILSON COVE' : `SCI ${id}` },
      geometry: { type: 'Polygon' as const, coordinates: [[...SECTIONS[id].ring, SECTIONS[id].ring[0]]] },
    })),
  };
}

/** Is a point inside a section? (ray casting) — used to warn when the boat is inside a closed one. */
export function sectionAt(lat: number, lon: number): SectionId | null {
  for (const id of Object.keys(SECTIONS) as SectionId[]) {
    const r = SECTIONS[id].ring;
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return id;
  }
  return null;
}
