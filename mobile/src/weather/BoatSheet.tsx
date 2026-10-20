// "My boat": the forecast is rated for this boat. Saved on the phone.
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, touch, makeStyles } from '../theme';
import { Btn, Note, Row } from '../components/ui';
import { BOAT_TYPES, COMFORT, type Boat } from './model';

export function BoatSheet({ boat, onSave, onClose }: { boat: Boat; onSave: (b: Boat) => void; onClose: () => void }) {
  const st = useSt();
  const insets = useSafeAreaInsets();
  const [type, setType] = useState(boat.type);
  const [len, setLen] = useState(boat.length_ft ? String(boat.length_ft) : '');
  const [comfort, setComfort] = useState(boat.comfort);
  const n = Number(len);
  const lenOk = !len || (n >= 6 && n <= 120);
  return (
    <View style={[st.wrap, { paddingTop: insets.top + 12 }]}>
      <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
        <Text style={st.title}>My boat</Text>
        <Note>The forecast is rated for this boat: 🟢 Comfortable · 🟡 Bumpy · 🟠 Rough · 🔴 Stay in.</Note>
        <Text style={st.h}>Type</Text>
        <View style={st.chips}>
          {BOAT_TYPES.map((t) => (
            <Pressable key={t.key} onPress={() => { setType(t.key); if (!len) setLen(String(t.typical)); }}
              style={[st.chip, type === t.key && st.on]} accessibilityRole="radio" accessibilityState={{ selected: type === t.key }}>
              <Text style={[st.chipT, type === t.key && st.onT]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={st.h}>Length (feet)</Text>
        <TextInput value={len} onChangeText={(s: string) => setLen(s.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="e.g. 23"
          placeholderTextColor={colors.muted} style={[st.input, !lenOk && { borderColor: colors.alert }]} accessibilityLabel="Boat length in feet" />
        {!lenOk ? <Note color={colors.alert}>Enter a length between 6 and 120 ft.</Note> : null}
        <Text style={st.h}>How cautious should the rating be?</Text>
        {COMFORT.map((c) => (
          <Pressable key={c.key} onPress={() => setComfort(c.key)} style={[st.opt, comfort === c.key && st.on]}
            accessibilityRole="radio" accessibilityState={{ selected: comfort === c.key }}>
            <Text style={[st.chipT, comfort === c.key && st.onT]}>{c.label}</Text>
            <Text style={[st.sub, comfort === c.key && { color: colors.accentInk }]}>{c.sub}</Text>
          </Pressable>
        ))}
        <Note>Ratings use NWS forecast seas, swell period and wind, plus NWS Small Craft Advisory and gale criteria. They are planning guidance, not a guarantee — NWS warnings and your own judgment come first.</Note>
        <Row>
          <Btn label="Cancel" onPress={onClose} />
          <Btn label="Save" kind="primary" disabled={!lenOk}
            onPress={() => onSave({ type, length_ft: len ? Math.round(n) : null, comfort })} />
        </Row>
      </ScrollView>
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  wrap: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.bg, zIndex: 30, paddingTop: 50 },
  body: { padding: 16, gap: 10, paddingBottom: 40 },
  title: { color: colors.text, fontSize: 26, fontWeight: '800' },
  h: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 20, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  opt: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12, minHeight: touch.min },
  on: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipT: { color: colors.text, fontSize: 15, fontWeight: '600' },
  onT: { color: colors.accentInk },
  sub: { color: colors.muted, fontSize: 12.5, marginTop: 2 },
  input: { height: touch.min, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, fontSize: 18, backgroundColor: colors.panelSolid, maxWidth: 160 },
}));
