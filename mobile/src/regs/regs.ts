// Fish size and bag limits (Nov 3): the rules, search, and "is it open today?" — pure and tested (regs.test.ts).
// The rules come from api/regs/regs.json (written from the official CDFW pages); a copy is built into the app
// (bundled.ts) so it works with no signal, and the newest copy is downloaded from the server when there is.

export type Group = 'fish' | 'rockfish' | 'shell' | 'prohibited' | 'general';
export type State = 'open' | 'limited' | 'closed' | 'prohibited' | 'check';
export type Period = { start: string; end: string; state: State; note: string };
export type Yearly = { from: string; to: string; state: State; note: string };
export type Rule = {
  id: string; name: string; group: Group; aka: string[]; size: string; bag: string; season: string; notes: string[]; src: string;
  status?: 'prohibited'; periods?: Period[]; yearly?: Yearly[]; rule?: 'lobster';
  after?: { state: State; note: string }; before?: { state: State; note: string };
  facts?: { bag?: number; size?: number };   // the numbers the server re-checks 3 ways when CDFW changes a page
};
export type RegsData = {
  version: string; checked: string; area: string;
  sources: Record<string, { title: string; url: string }>;
  items: Rule[];
  watch?: { checked_at: string | null; changed: Record<string, string>; verified?: Record<string, string>; unsure?: string[] };
};
export type Status = { state: State; note: string };

export const STATE_LABEL: Record<State, string> = {
  open: 'Open now', limited: 'Open with limits', closed: 'Closed now', prohibited: 'Off limits', check: 'Check CDFW',
};

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const md = (d: Date) => ymd(d).slice(5);
const short = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** First Wednesday of a month (month 0-11). */
function firstWed(y: number, m: number): Date { const d = new Date(y, m, 1); d.setDate(1 + ((3 - d.getDay() + 7) % 7)); return d; }
/** Lobster opens 6 p.m. on the Friday before the first Wednesday in October … */
export function lobsterOpens(y: number): Date { const w = firstWed(y, 9); return new Date(y, 9, w.getDate() - 5, 18, 0, 0); }
/** … and closes at the end of the first Wednesday after March 15. */
export function lobsterCloses(y: number): Date { const d = new Date(y, 2, 16); d.setDate(16 + ((3 - d.getDay() + 7) % 7)); d.setHours(23, 59, 59); return d; }

export function statusOn(r: Rule, now: Date = new Date()): Status {
  if (r.status === 'prohibited' && !r.periods) return { state: 'prohibited', note: 'Never allowed' };
  if (r.rule === 'lobster') {
    const y = now.getFullYear();
    if (now <= lobsterCloses(y)) return { state: 'open', note: `Open until ${lobsterCloses(y).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` };
    if (now >= lobsterOpens(y)) return { state: 'open', note: `Open until ${lobsterCloses(y + 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` };
    return { state: 'closed', note: `Opens ${lobsterOpens(y).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at 6 p.m.` };
  }
  const today = ymd(now);
  if (r.periods?.length) {
    const p = r.periods.find((x) => x.start <= today && today <= x.end);
    if (p) {
      const next = r.periods.find((x) => x.start > p.end);
      return { state: p.state, note: `${p.note}${next ? ` · until ${short(p.end)}` : ''}` };
    }
    const last = r.periods[r.periods.length - 1];
    if (today > last.end && r.after) return r.after;
    if (today < r.periods[0].start && r.before) return r.before;
  }
  if (r.yearly?.length) {
    const d = md(now);
    const y = r.yearly.find((x) => (x.from <= x.to ? x.from <= d && d <= x.to : d >= x.from || d <= x.to));
    if (y) return { state: y.state, note: y.note };
  }
  return { state: 'open', note: r.season };
}

/** Did CDFW change the official page this rule came from, after the rules were checked? (weekly server check)
 *  'rechecked' = the server read the new page 3 different ways and the size and bag limit check out (or were updated);
 *  'check' = a person needs to look (the reads didn't agree, or this rule has things the server can't re-check). */
export function changedOn(data: RegsData, r: Rule): { on: string; kind: 'rechecked' | 'check' } | null {
  const on = data.watch?.changed?.[r.src];
  if (!on) return null;
  const v = data.watch?.verified?.[r.id];
  if (v && v >= on && !data.watch?.unsure?.includes(r.id)) return { on, kind: 'rechecked' };
  return { on, kind: 'check' };
}

const norm = (s: string) => s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9½¼ ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Small typo allowance: "baracuda", "yellotail", "sheepshead". */
function near(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2) return false;
  const max = b.length >= 7 ? 2 : b.length >= 4 ? 1 : 0;
  if (!max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] <= max;
}

/** Search everything: names and nicknames first, then anything written in the rule (size, limit, notes). */
export function search(items: Rule[], q: string): Rule[] {
  const query = norm(q);
  if (!query) return items;
  const words = query.split(' ');
  const scored: { r: Rule; s: number }[] = [];
  for (const r of items) {
    const names = [r.name, ...r.aka].map(norm);
    const nameWords = names.join(' ').split(' ');
    const body = norm([r.size, r.bag, r.season, ...r.notes].join(' '));
    let s = 0;
    if (names.some((n) => n === query)) s = 100;
    else if (names.some((n) => n.startsWith(query))) s = 80;
    else if (names.some((n) => n.includes(query))) s = 60;
    else if (words.every((w) => nameWords.some((n) => n.startsWith(w) || near(w, n)))) s = 40;
    else if (words.every((w) => body.includes(w) || nameWords.some((n) => n.startsWith(w)))) s = 15;
    if (s) scored.push({ r, s });
  }
  return scored.sort((a, b) => b.s - a.s).map((x) => x.r);
}

export type Tab = 'all' | 'fish' | 'rockfish' | 'shell' | 'off' | 'saved' | 'basics';
export const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'fish', label: 'Fish' }, { key: 'rockfish', label: 'Rockfish' },
  { key: 'shell', label: 'Lobster & shellfish' }, { key: 'off', label: 'Off limits' }, { key: 'saved', label: 'Saved' }, { key: 'basics', label: 'Basics' },
];

/** "Off limits" = never allowed, plus anything closed today (rockfish in winter, grunion in spring, lobster in summer). */
export function inTab(r: Rule, tab: Tab, saved: Set<string>, now: Date = new Date()): boolean {
  switch (tab) {
    case 'all': return true;
    case 'fish': return r.group === 'fish';
    case 'rockfish': return r.group === 'rockfish';
    case 'shell': return r.group === 'shell';
    case 'basics': return r.group === 'general';
    case 'saved': return saved.has(r.id);
    case 'off': { const st = statusOn(r, now).state; return st === 'prohibited' || st === 'closed'; }
  }
}

/** How old the rules on this phone are (days since they were checked against CDFW). */
export const daysOld = (data: RegsData, now: Date = new Date()) => Math.floor((now.getTime() - new Date(`${data.checked}T12:00:00`).getTime()) / 86400000);
