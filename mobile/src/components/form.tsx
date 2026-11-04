// Nov 4: one clean look for every form and sheet (Log a catch, whale sighting, save spot, send to crew, feedback…).
//   • The sheet body is the theme's background color; each part of the form sits in its own white card with a
//     defined border, so sections are obvious and the boxes have contrast.
//   • Same 14-pt side margins, 12-pt gaps between cards, 12-pt corners everywhere.
//   • Choices: a few big ones → TileGrid (equal tiles, 3 across). Small optional ones → ChipSet (small chips).
//   • The main button is pinned to the bottom (SaveBar) so it never scrolls away.
// Works in every theme (day, night, red light): it only uses the theme's colors.
import type { ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, makeStyles } from '../theme';

/** Light see-through version of a theme color (for selected chips). Falls back to the inset color. */
export const tint = (c: string, alpha = '22') => (/^#[0-9a-f]{6}$/i.test(c) ? c + alpha : colors.inset);

/** Full form sheet: grabber, title, small location tag, ✕, scrolling cards, and a pinned bottom bar. */
export function FormSheet({ title, where, hint, onClose, footer, children, top }: {
  title: string; where?: string; hint?: string; onClose: () => void; footer?: ReactNode; children: ReactNode; top?: number;
}) {
  const st = useSt();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[st.sheet, { top: top ?? insets.top + 56 }]}>
      <View style={st.grab} />
      <View style={st.head}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={st.title} numberOfLines={2}>{title}</Text>
          {where ? <View style={st.where}><Ionicons name="location" size={13} color={colors.accent} /><Text style={st.whereT} numberOfLines={1}>{where}</Text></View> : null}
          {hint ? <View style={st.hintRow}><Ionicons name="sparkles-outline" size={13} color={colors.muted} /><Text style={st.hint}>{hint}</Text></View> : null}
        </View>
        <Pressable onPress={onClose} style={({ pressed }) => [st.x, pressed && { opacity: 0.6 }]} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={19} color={colors.text} />
        </Pressable>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 2, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {footer ? <View style={[st.footer, { paddingBottom: Math.max(12, insets.bottom) }]}>{footer}</View> : null}
    </KeyboardAvoidingView>
  );
}

/** One section of a form: a white card with a small label and "Required" / "Optional" on the right. */
export function FormCard({ label, tag, children, tone }: { label?: string; tag?: string; children: ReactNode; tone?: 'info' }) {
  const st = useSt();
  return (
    <View style={[st.card, tone === 'info' && { borderColor: colors.accent }]}>
      {label ? <View style={st.labelRow}><Text style={st.label}>{label}</Text>{tag ? <Text style={st.tag}>{tag}</Text> : null}</View> : null}
      {children}
    </View>
  );
}

/** A small label + tag line inside a card (when a card holds two parts). */
export function CardLabel({ label, tag }: { label: string; tag?: string }) {
  const st = useSt();
  return <View style={st.labelRow}><Text style={st.label}>{label}</Text>{tag ? <Text style={st.tag}>{tag}</Text> : null}</View>;
}

/** Equal tiles, 3 across (or `cols`). The picked one fills with the theme's main color. */
export function TileGrid<K extends string>({ items, value, onChange, cols = 3 }: {
  items: { key: K; label: string; dot?: string; icon?: ReactNode }[]; value: K | null; onChange: (k: K) => void; cols?: number;
}) {
  const st = useSt();
  const rows: typeof items[] = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  return (
    <View style={{ gap: 8 }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', gap: 8 }}>
          {row.map((it) => {
            const on = it.key === value;
            return (
              <Pressable key={it.key} onPress={() => onChange(it.key)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={it.label}
                style={({ pressed }) => [st.tile, on && st.tileOn, pressed && { opacity: 0.75 }]}>
                {it.icon ?? null}
                {it.dot ? <View style={[st.dot, { backgroundColor: it.dot }, on && { borderColor: colors.accentInk }]} /> : null}
                <Text style={[st.tileT, on && { color: colors.accentInk }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{it.label}</Text>
              </Pressable>
            );
          })}
          {Array.from({ length: cols - row.length }).map((_, i) => <View key={`pad${i}`} style={{ flex: 1 }} />)}
        </View>
      ))}
    </View>
  );
}

/** Small chips for optional choices. Picked = light tint of the main color with a colored border. */
export function ChipSet<K extends string>({ items, value, onChange }: { items: { key: K; label: string; icon?: string }[]; value: K | K[] | null; onChange: (k: K) => void }) {
  const st = useSt();
  const isOn = (k: K) => (Array.isArray(value) ? value.includes(k) : value === k);
  return (
    <View style={st.chips}>
      {items.map((it) => {
        const on = isOn(it.key);
        return (
          <Pressable key={it.key} onPress={() => onChange(it.key)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={it.label}
            style={({ pressed }) => [st.chip, on && { backgroundColor: tint(colors.accent), borderColor: colors.accent }, pressed && { opacity: 0.7 }]}>
            {it.icon ? <Ionicons name={it.icon as any} size={15} color={on ? colors.accent : colors.text} /> : null}
            <Text style={[st.chipT, on && { color: colors.accent }]} numberOfLines={1}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Compact − 1 + counter. */
export function Stepper({ value, onChange, min = 1, max = 500, wide }: { value: number; onChange: (n: number) => void; min?: number; max?: number; wide?: boolean }) {
  const st = useSt();
  const b = wide ? [st.stepB, { width: 32 }] : st.stepB;
  return (
    <View style={[st.stepper, wide && { alignSelf: 'stretch' }]}>
      <Pressable style={b} onPress={() => onChange(Math.max(min, value - 1))} hitSlop={6} accessibilityRole="button" accessibilityLabel="Fewer"><Ionicons name="remove" size={20} color={colors.accent} /></Pressable>
      <Text style={[st.stepN, wide && { flex: 1, minWidth: 24 }]}>{value}</Text>
      <Pressable style={b} onPress={() => onChange(Math.min(max, value + 1))} hitSlop={6} accessibilityRole="button" accessibilityLabel="More"><Ionicons name="add" size={20} color={colors.accent} /></Pressable>
    </View>
  );
}

/** A row inside a card: label (and a small line under it) on the left, a control on the right. */
export function FormRow({ title, sub, right, last }: { title: string; sub?: string; right?: ReactNode; last?: boolean }) {
  const st = useSt();
  return (
    <View style={[st.row, !last && st.rowLine]}>
      <View style={{ flex: 1 }}><Text style={st.rowT}>{title}</Text>{sub ? <Text style={st.rowS}>{sub}</Text> : null}</View>
      {right}
    </View>
  );
}

export function ToggleRow({ title, sub, value, onChange, last }: { title: string; sub?: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  return <FormRow title={title} sub={sub} last={last} right={<Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent, false: colors.line }} />} />;
}

/** Small label + input box, for putting 2–3 side by side (Weight · Length). */
export function Field({ label, value, onChangeText, unit, placeholder, keyboardType, multiline, flex = 1 }: {
  label?: string; value: string; onChangeText: (s: string) => void; unit?: string; placeholder?: string; keyboardType?: 'default' | 'number-pad' | 'decimal-pad' | 'numeric' | 'email-address' | 'phone-pad'; multiline?: boolean; flex?: number;
}) {
  const st = useSt();
  return (
    <View style={{ flex }}>
      {label ? <Text style={st.fieldL}>{label}</Text> : null}
      <View style={[st.input, multiline && { minHeight: 76, alignItems: 'flex-start', paddingVertical: 8 }]}>
        <TextInput style={[st.inputT, multiline && { textAlignVertical: 'top', minHeight: 60 }]} value={value} onChangeText={onChangeText} placeholder={placeholder}
          placeholderTextColor={colors.faint} keyboardType={keyboardType} multiline={multiline} accessibilityLabel={label ?? placeholder} />
        {unit ? <Text style={st.unit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

/** iPhone-style segmented switch with an explanation of the picked option underneath. */
export function Segment<K extends string>({ options, value, onChange }: { options: { key: K; label: string; note?: string }[]; value: K; onChange: (k: K) => void }) {
  const st = useSt();
  const cur = options.find((o) => o.key === value);
  return (
    <View style={{ gap: 8 }}>
      <View style={st.seg} accessibilityRole="tablist">
        {options.map((o) => {
          const on = o.key === value;
          return (
            <Pressable key={o.key} onPress={() => onChange(o.key)} style={[st.segI, on && st.segOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              <Text style={[st.segT, on && { color: colors.text }]} numberOfLines={1}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {cur?.note ? <Text style={st.small}>{cur.note}</Text> : null}
    </View>
  );
}

/** "More details ›" row that opens/closes extra cards. */
export function Disclosure({ title, sub, open, onPress }: { title: string; sub?: string; open: boolean; onPress: () => void }) {
  const st = useSt();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.card, st.disc, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityState={{ expanded: open }}>
      <Ionicons name={open ? 'remove-circle-outline' : 'add-circle-outline'} size={20} color={colors.accent} />
      <Text style={st.discT}>{title}</Text>
      {sub && !open ? <Text style={st.discS} numberOfLines={1}>{sub}</Text> : null}
      <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.faint} />
    </Pressable>
  );
}

/** A list of choices with a short explanation each (one can be picked), shown as rows inside a card. */
export function RadioList<K extends string>({ items, value, onChange }: { items: { key: K; label: string; sub?: string }[]; value: K | null; onChange: (k: K) => void }) {
  const st = useSt();
  return (
    <View>
      {items.map((it, i) => {
        const on = it.key === value;
        return (
          <Pressable key={it.key} onPress={() => onChange(it.key)} accessibilityRole="radio" accessibilityState={{ checked: on }}
            style={({ pressed }) => [st.row, i < items.length - 1 && st.rowLine, pressed && { opacity: 0.7 }]}>
            <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? colors.accent : colors.faint} />
            <View style={{ flex: 1 }}><Text style={[st.rowT, on && { color: colors.accent }]}>{it.label}</Text>{it.sub ? <Text style={st.rowS}>{it.sub}</Text> : null}</View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Small icon + gray text line between cards (rules, privacy notes). */
export function InfoLine({ text, icon = 'information-circle-outline' }: { text: string; icon?: string }) {
  const st = useSt();
  return <View style={st.info}><Ionicons name={icon as any} size={16} color={colors.muted} /><Text style={[st.small, { flex: 1 }]}>{text}</Text></View>;
}

/** The pinned main button. Until the form is ready it says what's missing instead of just looking faded. */
export function SaveBar({ label, onPress, disabled, missing, busy, secondary }: {
  label: string; onPress: () => void; disabled?: boolean; missing?: string | null; busy?: boolean; secondary?: { label: string; onPress: () => void; danger?: boolean };
}) {
  const st = useSt();
  const off = disabled || !!missing || busy;
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {secondary ? (
        <Pressable onPress={secondary.onPress} style={({ pressed }) => [st.save2, secondary.danger && { borderColor: colors.alert }, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <Text style={[st.save2T, secondary.danger && { color: colors.alert }]}>{secondary.label}</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={off ? undefined : onPress} accessibilityRole="button" accessibilityState={{ disabled: !!off }} accessibilityLabel={missing ?? label}
        style={({ pressed }) => [st.save, off && st.saveOff, pressed && !off && { opacity: 0.85 }]}>
        {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={[st.saveT, off && { color: colors.muted }]}>{missing ?? label}</Text>}
      </Pressable>
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: colors.border, zIndex: 30, overflow: 'hidden',
    shadowColor: colors.shadow, shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: -3 }, elevation: 12 },
  grab: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: colors.border, marginTop: 8, marginBottom: 8 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 14, paddingBottom: 12 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.2 },
  where: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, backgroundColor: colors.panelSolid, borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, maxWidth: '100%' },
  whereT: { color: colors.text, fontSize: 12.5, fontVariant: ['tabular-nums'], flexShrink: 1 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  hint: { color: colors.muted, fontSize: 12, flexShrink: 1 },
  x: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.inset, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: colors.panelSolid, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14, marginHorizontal: 14, marginBottom: 12, gap: 10 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  tag: { color: colors.faint, fontSize: 12, fontWeight: '600' },
  tile: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, paddingHorizontal: 6, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.inset },
  tileOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tileT: { color: colors.text, fontSize: 13.5, fontWeight: '700', flexShrink: 1 },
  dot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1, borderColor: 'transparent' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.inset },
  chipT: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', height: 42, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.inset, overflow: 'hidden' },
  stepB: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  stepN: { minWidth: 40, textAlign: 'center', color: colors.text, fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'], lineHeight: 40, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 4 },
  rowLine: { borderBottomWidth: 1, borderColor: colors.line, paddingBottom: 10 },
  rowT: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowS: { color: colors.muted, fontSize: 12.5, marginTop: 1 },
  fieldL: { color: colors.muted, fontSize: 12, fontWeight: '600', marginBottom: 5 },
  input: { flexDirection: 'row', alignItems: 'center', minHeight: 42, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.inset, paddingHorizontal: 10 },
  inputT: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 6 },
  unit: { color: colors.muted, fontSize: 14, marginLeft: 4 },
  seg: { flexDirection: 'row', backgroundColor: colors.inset, borderRadius: 10, padding: 3, borderWidth: 1, borderColor: colors.line },
  segI: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 8, paddingHorizontal: 4 },
  segOn: { backgroundColor: colors.panelSolid, borderWidth: 1, borderColor: colors.border, shadowColor: colors.shadow, shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segT: { color: colors.muted, fontSize: 13.5, fontWeight: '700' },
  small: { color: colors.muted, fontSize: 12.5, lineHeight: 17 },
  disc: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 13 },
  discT: { color: colors.text, fontSize: 15, fontWeight: '700' },
  discS: { flex: 1, color: colors.muted, fontSize: 12.5, textAlign: 'right' },
  info: { flexDirection: 'row', gap: 7, alignItems: 'flex-start', paddingHorizontal: 18, paddingBottom: 12 },
  footer: { backgroundColor: colors.panelSolid, borderTopWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingTop: 12 },
  save: { flex: 1, minHeight: 50, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  saveOff: { backgroundColor: colors.inset, borderWidth: 1.5, borderColor: colors.border },
  saveT: { color: colors.accentInk, fontSize: 16, fontWeight: '800' },
  save2: { minHeight: 50, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.panelSolid, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  save2T: { color: colors.text, fontSize: 15, fontWeight: '700' },
}));
