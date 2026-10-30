// Shared building blocks. One look everywhere: defined borders, clear hierarchy, big touch targets for a moving boat.
import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cardStyle, colors, makeStyles, radius, touch } from '../theme';

export type IconName = string;
export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name as any} size={size} color={color ?? colors.text} />;
}

/** Bottom sheet over the map. With onClose: a small round ✕ at the top right (Oct 29: replaces the old full-width
 *  "Close" buttons at the bottom). */
export function Sheet({ children, maxHeight = 460, onClose }: { children: ReactNode; maxHeight?: number; onClose?: () => void }) {
  const s = useS();
  return (
    <View style={[s.sheet, { maxHeight }]}>
      <View style={s.handle} />
      {onClose ? (
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close"
          style={({ pressed }) => [s.sheetX, pressed && { opacity: 0.6 }]}>
          <Ionicons name="close" size={20} color={colors.text} />
        </Pressable>
      ) : null}
      <ScrollView contentContainerStyle={[{ gap: 10 }, onClose ? { paddingTop: 2 } : null]} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </View>
  );
}

export function Btn({ label, onPress, kind = 'plain', disabled, icon }: { label: string; onPress: () => void; kind?: 'plain' | 'primary' | 'danger'; disabled?: boolean; icon?: IconName }) {
  const s = useS();
  const bg = kind === 'primary' ? colors.accent : colors.panelSolid;
  const border = kind === 'primary' ? colors.accent : kind === 'danger' ? colors.alert : colors.border;
  const fg = kind === 'primary' ? colors.accentInk : kind === 'danger' ? colors.alert : colors.text;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 }]}>
      {icon ? <Ionicons name={icon as any} size={19} color={fg} /> : null}
      <Text style={[s.btnT, { color: fg }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/** Round/square control used on the map (layers, compass, locate, day/night). */
export function IconButton({ icon, onPress, label, active, size = 48 }: { icon: IconName; onPress: () => void; label: string; active?: boolean; size?: number }) {
  const s = useS();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => [s.iconBtn, { width: size, height: size }, active && { backgroundColor: colors.accent, borderColor: colors.accent }, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon as any} size={Math.round(size * 0.46)} color={active ? colors.accentInk : colors.text} />
    </Pressable>
  );
}

export function Stat({ k, v, big, color }: { k: string; v: string; big?: boolean; color?: string }) {
  const s = useS();
  return (
    <View style={s.stat}>
      <Text style={s.k}>{k}</Text>
      <Text style={[s.v, big && s.vBig, color ? { color } : null]}>{v}</Text>
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) { const s = useS(); return <View style={s.row}>{children}</View>; }
export function Title({ children }: { children: ReactNode }) { const s = useS(); return <Text style={s.title}>{children}</Text>; }
export function Note({ children, color }: { children: ReactNode; color?: string }) { const s = useS(); return <Text style={[s.note, color ? { color } : null]}>{children}</Text>; }

/** White card with a defined border. */
export function Card({ children, style, tone }: { children: ReactNode; style?: any; tone?: 'alert' | 'warn' | 'ok' | 'info' }) {
  const s = useS();
  const toneStyle = tone === 'alert' ? { backgroundColor: colors.alertBg, borderColor: colors.alert } : tone === 'warn' ? { backgroundColor: colors.warnBg, borderColor: colors.accent }
    : tone === 'ok' ? { backgroundColor: colors.okBg, borderColor: colors.ok } : tone === 'info' ? { backgroundColor: colors.infoBg, borderColor: colors.live } : null;
  return <View style={[s.card, toneStyle, style]}>{children}</View>;
}

/** Small uppercase label above a group, like iOS Settings. */
export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const s = useS();
  return <View style={s.sectionRow}><Text style={s.section}>{children}</Text>{right}</View>;
}

/** A grouped list (rows separated by hairlines inside one bordered card). */
export function ListGroup({ children }: { children: ReactNode }) {
  const s = useS();
  return <View style={s.group}>{children}</View>;
}
export function ListRow({ icon, iconColor, title, subtitle, value, onPress, danger, chevron = true, right, last }: {
  icon?: IconName; iconColor?: string; title: string; subtitle?: string; value?: string; onPress?: () => void; danger?: boolean; chevron?: boolean; right?: ReactNode; last?: boolean;
}) {
  const s = useS();
  const body = (
    <View style={[s.listRow, !last && s.listRowLine]}>
      {icon ? <View style={[s.listIcon, { backgroundColor: (iconColor ?? colors.live) + '1F' }]}><Ionicons name={icon as any} size={18} color={iconColor ?? colors.live} /></View> : null}
      <View style={{ flex: 1 }}>
        <Text style={[s.listTitle, danger && { color: colors.alert }]}>{title}</Text>
        {subtitle ? <Text style={s.listSub} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={s.listValue}>{value}</Text> : null}
      {right}
      {onPress && chevron ? <Ionicons name="chevron-forward" size={18} color={colors.faint} /> : null}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} style={({ pressed }) => pressed && { opacity: 0.6 }}>{body}</Pressable> : body;
}

/** Two to four mutually exclusive choices. */
export function Segmented<T extends string>({ options, value, onChange }: { options: { key: T; label: string; icon?: IconName }[]; value: T; onChange: (v: T) => void }) {
  const s = useS();
  return (
    <View style={s.seg} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} style={[s.segItem, on && s.segOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
            {o.icon ? <Ionicons name={o.icon as any} size={16} color={on ? colors.accentInk : colors.text} /> : null}
            <Text style={[s.segT, on && { color: colors.accentInk }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Screen title bar with optional back button and right-side action. */
export function ScreenHeader({ title, subtitle, onBack, backLabel = 'Back', right }: { title: string; subtitle?: string; onBack?: () => void; backLabel?: string; right?: ReactNode }) {
  const s = useS();
  return (
    <SafeAreaView edges={['top']} style={s.header}>
      {onBack ? (
        <Pressable onPress={onBack} style={s.back} accessibilityRole="button" accessibilityLabel={backLabel} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.live} /><Text style={s.backT}>{backLabel}</Text>
        </Pressable>
      ) : null}
      <View style={s.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.headerT} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={s.headerS} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
    </SafeAreaView>
  );
}

/** "‹ Back" control at the top of a sub-page: a real button, not loose text. */
export function BackLink({ label, onPress }: { label: string; onPress: () => void }) {
  const s = useS();
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.6 }]}>
      <Ionicons name="chevron-back" size={20} color={colors.live} /><Text style={s.backT}>{label}</Text>
    </Pressable>
  );
}

/** Small outlined button for actions inside a card or row (Delete, Remove, Show on map). */
export function SmallBtn({ label, onPress, icon, tone = 'plain', disabled }: { label: string; onPress: () => void; icon?: IconName; tone?: 'plain' | 'accent' | 'danger'; disabled?: boolean }) {
  const s = useS();
  const fg = tone === 'danger' ? colors.alert : tone === 'accent' ? colors.live : colors.text;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}
      style={({ pressed }) => [s.small, tone === 'danger' && { borderColor: colors.alert }, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
      {icon ? <Ionicons name={icon as any} size={16} color={fg} /> : null}
      <Text style={[s.smallT, { color: fg }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/** Pill-shaped choice (filters, tags). Filled in the brand color when selected. */
export function Chip({ label, on, onPress, icon, dot }: { label: string; on?: boolean; onPress: () => void; icon?: IconName; dot?: string }) {
  const s = useS();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!on }} accessibilityLabel={label}
      style={({ pressed }) => [s.chip, on && s.chipOn, pressed && { opacity: 0.7 }]}>
      {dot ? <View style={[s.chipDot, { backgroundColor: dot }]} /> : null}
      {icon ? <Ionicons name={icon as any} size={16} color={on ? colors.accentInk : colors.text} /> : null}
      <Text style={[s.chipT, on && { color: colors.accentInk }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const useS = makeStyles((colors) => ({
  sheet: { backgroundColor: colors.panelSolid, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14,
    shadowColor: colors.shadow, shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: -2 }, elevation: 8 },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 8 },
  sheetX: { position: 'absolute', top: 12, right: 12, zIndex: 5, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.border },
  btn: { flex: 1, flexDirection: 'row', gap: 8, minHeight: touch.min, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  btnT: { fontSize: 16.5, fontWeight: '700' },
  iconBtn: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.shadow, shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  row: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, gap: 1 },
  k: { color: colors.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  v: { color: colors.text, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  vBig: { fontSize: 34, fontWeight: '800' },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', paddingRight: 40 },   // room for the ✕
  note: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  card: { ...cardStyle(colors), padding: 14, gap: 8 },
  sectionRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 8, marginBottom: 2, paddingHorizontal: 4 },
  section: { color: colors.muted, fontSize: 12.5, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  group: { ...cardStyle(colors), paddingHorizontal: 0, overflow: 'hidden' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: touch.min, paddingHorizontal: 14, paddingVertical: 10 },
  listRowLine: { borderBottomWidth: 1, borderColor: colors.line },
  listIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  listTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  listSub: { color: colors.muted, fontSize: 13, marginTop: 1 },
  listValue: { color: colors.muted, fontSize: 15 },
  seg: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.inset },
  segItem: { flex: 1, flexDirection: 'row', gap: 6, minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  segOn: { backgroundColor: colors.accent },
  segT: { color: colors.text, fontWeight: '700', fontSize: 14 },
  header: { backgroundColor: colors.panelSolid, borderBottomWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingBottom: 10 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingTop: 6, marginLeft: -6 },
  backT: { color: colors.live, fontSize: 16, fontWeight: '600' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingTop: 6 },
  headerT: { color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.3 },
  headerS: { color: colors.muted, fontSize: 13.5 },
  backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2, minHeight: 40, paddingRight: 10, marginLeft: -4 },
  small: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, minHeight: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.panelSolid },
  smallT: { fontSize: 14.5, fontWeight: '700' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.panelSolid },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)' },
  chipT: { color: colors.text, fontSize: 14, fontWeight: '700' },
}));
