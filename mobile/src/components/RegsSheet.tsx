// "Fish size and limits" (Nov 3), from the blue + menu: every California saltwater size and bag limit for SoCal,
// with search (names, nicknames, typos, anything in the rule), tabs, Saved stars, and today's open/closed status.
// Works with no signal (built-in copy + last download); with signal it gets the newest rules from the server, which
// re-checks the official CDFW pages every week and marks any rule CDFW has changed.
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getJSON } from '../api';
import { colors, makeStyles } from '../theme';
import { track } from '../analytics';
import { BUNDLED } from '../regs/bundled';
import { STATE_LABEL, TABS, changedOn, daysOld, inTab, search, statusOn, type RegsData, type Rule, type State, type Tab } from '../regs/regs';

const DATA_KEY = 'regs:data';
const SAVED_KEY = 'regs:saved';
const FETCHED_KEY = 'regs:fetchedAt';

/** The newest rules on this phone: the download if there is one, otherwise the built-in copy. */
async function localRegs(): Promise<RegsData> {
  try {
    const raw = await AsyncStorage.getItem(DATA_KEY);
    if (raw) { const d = JSON.parse(raw) as RegsData; if (d?.items?.length && d.checked >= BUNDLED.checked) return d; }
  } catch { /* fall through */ }
  return BUNDLED;
}

/** Download the newest rules (kept on the phone for offline). Called when the page opens, and once a week on app start. */
export async function refreshRegs(): Promise<RegsData | null> {
  try {
    const r = await getJSON<RegsData>('/regs', { timeoutMs: 15000 });
    if (r.cached || !r.data?.items?.length) return null;
    await AsyncStorage.multiSet([[DATA_KEY, JSON.stringify(r.data)], [FETCHED_KEY, String(Date.now())]]);
    return r.data;
  } catch { return null; }
}
export async function refreshRegsWeekly() {
  try {
    const t = Number((await AsyncStorage.getItem(FETCHED_KEY)) ?? 0);
    if (Date.now() - t > 6 * 86400000) await refreshRegs();
  } catch { /* offline: try again next time */ }
}

const STATE_COLOR = (s: State) => (s === 'open' ? colors.ok : s === 'limited' ? colors.warn : s === 'check' ? colors.warn : colors.alert);
const STATE_BG = (s: State) => (s === 'open' ? colors.okBg : s === 'limited' || s === 'check' ? colors.warnBg : colors.alertBg);
const GROUP_ICON: Record<string, any> = { fish: 'fish', rockfish: 'fish-outline', shell: 'bug-outline', prohibited: 'ban', general: 'book-outline' };

export function RegsSheet({ onClose }: { onClose: () => void }) {
  const st = useSt();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<RegsData>(BUNDLED);
  const [online, setOnline] = useState<boolean | null>(null);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const now = new Date();

  useEffect(() => {
    let alive = true;
    localRegs().then((d) => { if (alive) setData(d); });
    AsyncStorage.getItem(SAVED_KEY).then((raw) => { if (alive && raw) setSaved(new Set(JSON.parse(raw))); }).catch(() => {});
    refreshRegs().then((d) => { if (!alive) return; setOnline(!!d); if (d) setData(d); });
    track('screen_view', { screen: 'regs' });
    return () => { alive = false; };
  }, []);

  const toggleSave = (id: string) => {
    const next = new Set(saved);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSaved(next);
    AsyncStorage.setItem(SAVED_KEY, JSON.stringify([...next])).catch(() => {});
  };

  const rows = useMemo(() => {
    const found = search(data.items, q);
    // while searching, look through every tab so nothing is missed
    return q.trim() ? found : found.filter((r) => inTab(r, tab, saved, now));
  }, [data, q, tab, saved]);   // eslint-disable-line react-hooks/exhaustive-deps

  const old = daysOld(data, now);
  const changedCount = data.items.filter((r) => changedOn(data, r)?.kind === 'check').length;

  return (
    <View style={[st.page, { paddingTop: insets.top + 6, paddingBottom: insets.bottom }]}>
      <View style={st.head}>
        <Text style={st.h1}>Fish size and limits</Text>
        <Pressable onPress={onClose} style={st.x} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close"><Ionicons name="close" size={22} color={colors.text} /></Pressable>
      </View>
      <View style={st.searchBox}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput style={st.input} value={q} onChangeText={setQ} placeholder="barracuda, lobster, calico, report card…" placeholderTextColor={colors.muted}
          autoCorrect={false} autoCapitalize="none" returnKeyType="search" clearButtonMode="while-editing" accessibilityLabel="Search the fishing rules" />
        {q ? <Pressable onPress={() => setQ('')} hitSlop={10} accessibilityLabel="Clear search"><Ionicons name="close-circle" size={18} color={colors.muted} /></Pressable> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={st.tabs} keyboardShouldPersistTaps="handled">
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => { setTab(t.key); setQ(''); }} style={[st.tab, tab === t.key && !q && st.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }}>
            <Text style={[st.tabT, tab === t.key && !q && { color: colors.accentInk }]}>{t.label}{t.key === 'saved' && saved.size ? ` (${saved.size})` : ''}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={st.status}>
        <Ionicons name={online ? 'checkmark-circle' : 'cloud-offline-outline'} size={15} color={online ? colors.ok : colors.muted} />
        <Text style={st.statusT} numberOfLines={2}>
          {online ? 'Up to date' : online === false ? 'Offline · saved on your phone' : 'Checking for updates…'} · rules checked {new Date(`${data.checked}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          {data.watch?.checked_at ? ` · CDFW re-checked ${new Date(data.watch.checked_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
        </Text>
      </View>
      {changedCount ? <Text style={st.warnBar}>CDFW changed some rules after this list was written. The fish marked "CDFW changed this" may be out of date. Tap Official rules on those.</Text>
        : old > 45 ? <Text style={st.warnBar}>These rules are {old} days old. Connect to the internet to get the newest copy, and check CDFW before you keep fish.</Text> : null}
      <FlatList data={rows} keyExtractor={(r) => r.id} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingBottom: 40 }}
        ListEmptyComponent={
          <View style={st.card}>
            <Text style={st.p}>{tab === 'saved' && !q ? 'Tap the star on any fish to keep it here.' : `Nothing saved on your phone matches "${q}".`}</Text>
            {q ? <Pressable style={st.link} onPress={() => Linking.openURL(`https://www.google.com/search?q=${encodeURIComponent(`site:wildlife.ca.gov ${q} sport fishing regulations`)}`)}>
              <Ionicons name="open-outline" size={16} color={colors.accent} /><Text style={st.linkT}>Search the CDFW website</Text></Pressable> : null}
          </View>}
        ListFooterComponent={<Text style={st.foot}>{data.area}. A quick guide to the official California rules, not a replacement. Rules can change during the season. Always check CDFW before you keep fish.</Text>}
        renderItem={({ item }) => <RuleCard r={item} data={data} now={now} open={open === item.id} saved={saved.has(item.id)}
          onPress={() => setOpen(open === item.id ? null : item.id)} onSave={() => toggleSave(item.id)} />} />
    </View>
  );
}

function RuleCard({ r, data, now, open, saved, onPress, onSave }: { r: Rule; data: RegsData; now: Date; open: boolean; saved: boolean; onPress: () => void; onSave: () => void }) {
  const st = useSt();
  const s = statusOn(r, now);
  const changed = changedOn(data, r);
  const src = data.sources[r.src];
  const general = r.group === 'general';
  return (
    <Pressable onPress={onPress} style={[st.card, s.state === 'prohibited' && { borderColor: colors.alert }]} accessibilityRole="button" accessibilityState={{ expanded: open }}>
      <View style={st.row}>
        <Ionicons name={GROUP_ICON[r.group] ?? 'fish'} size={18} color={s.state === 'prohibited' ? colors.alert : colors.accent} />
        <Text style={st.name}>{r.name}</Text>
        <Pressable onPress={onSave} hitSlop={10} accessibilityRole="button" accessibilityLabel={saved ? `Remove ${r.name} from saved` : `Save ${r.name}`}>
          <Ionicons name={saved ? 'star' : 'star-outline'} size={20} color={saved ? '#E8A400' : colors.muted} />
        </Pressable>
      </View>
      {!general ? <View style={[st.pill, { backgroundColor: STATE_BG(s.state), borderColor: STATE_COLOR(s.state) }]}>
        <Text style={[st.pillT, { color: STATE_COLOR(s.state) }]}>{STATE_LABEL[s.state]}</Text>
        {s.note && s.state !== 'prohibited' ? <Text style={[st.pillN, { color: STATE_COLOR(s.state) }]} numberOfLines={2}> · {s.note}</Text> : null}
      </View> : null}
      {changed?.kind === 'check' ? <Text style={st.changed}>⚠ CDFW changed this on {fmtDay(changed.on)}. Check the official rules.</Text>
        : changed ? <Text style={st.rechecked}>✓ CDFW updated its page {fmtDay(changed.on)}. Size and bag limit re-checked 3 ways. Tap Official rules for season details.</Text> : null}
      {general ? <Text style={st.p}>{r.bag}</Text> : (
        <>
          <Line k="Minimum size" v={r.size} />
          <Line k="Bag limit" v={r.bag} />
          {open ? <Line k="Season" v={r.season} /> : null}
        </>
      )}
      {open ? (
        <View style={{ gap: 6, marginTop: 4 }}>
          {r.notes.map((n, i) => <Text key={i} style={st.note}>• {n}</Text>)}
          {src ? <Pressable style={st.link} onPress={() => Linking.openURL(src.url)} accessibilityRole="link">
            <Ionicons name="open-outline" size={16} color={colors.accent} /><Text style={st.linkT}>Official rules: {src.title}</Text></Pressable> : null}
        </View>
      ) : r.notes.length || src ? <Text style={st.more}>Tap for {r.notes.length ? 'notes and ' : ''}the official rules</Text> : null}
    </Pressable>
  );
}

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function Line({ k, v }: { k: string; v: string }) {
  const st = useSt();
  return <View style={st.line}><Text style={st.k}>{k}</Text><Text style={st.v}>{v}</Text></View>;
}

const useSt = makeStyles((colors) => ({
  page: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.panelSolid, paddingHorizontal: 14, zIndex: 40, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center' },
  h1: { flex: 1, color: colors.text, fontSize: 24, fontWeight: '700' },
  x: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, backgroundColor: colors.panelSolid, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 46, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.inset, paddingHorizontal: 12 },
  input: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 8 },
  tabs: { gap: 6, paddingVertical: 2 },
  tab: { minHeight: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1.5, borderColor: colors.border, justifyContent: 'center' },
  tabOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tabT: { color: colors.text, fontWeight: '700', fontSize: 14 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusT: { flex: 1, color: colors.muted, fontSize: 12 },
  warnBar: { color: colors.warn, backgroundColor: colors.warnBg, borderRadius: 10, padding: 8, fontSize: 13, fontWeight: '600' },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, gap: 6, backgroundColor: colors.panelSolid },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, color: colors.text, fontSize: 16.5, fontWeight: '700' },
  pill: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, maxWidth: '100%', flexWrap: 'wrap' },
  pillT: { fontSize: 12.5, fontWeight: '800' },
  pillN: { fontSize: 12.5, fontWeight: '600', flexShrink: 1 },
  changed: { color: colors.warn, fontSize: 13, fontWeight: '700' },
  rechecked: { color: colors.ok, fontSize: 12.5, fontWeight: '600' },
  line: { flexDirection: 'row', gap: 10 },
  k: { width: 96, color: colors.muted, fontSize: 13.5 },
  v: { flex: 1, color: colors.text, fontSize: 14.5, fontWeight: '600' },
  p: { color: colors.text, fontSize: 14.5, lineHeight: 20 },
  note: { color: colors.text, fontSize: 13.5, lineHeight: 19 },
  more: { color: colors.muted, fontSize: 12 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  linkT: { color: colors.accent, fontWeight: '700', fontSize: 14, flexShrink: 1 },
  foot: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 6 },
}));
