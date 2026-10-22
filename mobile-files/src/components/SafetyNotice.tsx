// First-launch safety notice. Must be accepted once (and again if LEGAL_VERSION changes) before using the app.
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FIRST_LAUNCH, LEGAL_VERSION } from '../legal';
import { TERMS_URL } from '../config';
import { track } from '../analytics';
import { makeStyles, colors } from '../theme';

const KEY = 'legal-accepted';
export async function legalAccepted() {
  try { return Number((await AsyncStorage.getItem(KEY)) ?? '0') >= LEGAL_VERSION; } catch { return false; }
}

/** Renders nothing once accepted. `onAccepted` lets the app hold the sponsor intro until after this. */
export function SafetyNotice({ onAccepted }: { onAccepted: () => void }) {
  const st = useSt();
  const [show, setShow] = useState<boolean | null>(null);
  useEffect(() => { legalAccepted().then((ok) => { setShow(!ok); if (ok) onAccepted(); }); }, []);
  if (!show) return null;
  const accept = async () => {
    try { await AsyncStorage.setItem(KEY, String(LEGAL_VERSION)); } catch { /* still let them in */ }
    track('legal_accepted', { v: LEGAL_VERSION });
    setShow(false);
    onAccepted();
  };
  return (
    <View style={st.wrap}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={st.body}>
          <MaterialCommunityIcons name="anchor" size={44} color={colors.accent} style={{ alignSelf: 'center' }} />
          <Text style={st.h1}>Before you head out</Text>
          <Text style={st.sub}>Please read — this takes 30 seconds.</Text>
          {FIRST_LAUNCH.map((x) => (
            <View key={x.title} style={st.row}>
              <View style={st.icon}><MaterialCommunityIcons name={x.icon as any} size={22} color={colors.accent} /></View>
              <View style={{ flex: 1 }}>
                <Text style={st.t}>{x.title}</Text>
                <Text style={st.p}>{x.text}</Text>
              </View>
            </View>
          ))}
          {TERMS_URL ? <Pressable onPress={() => Linking.openURL(TERMS_URL)}><Text style={st.link}>Read the full Terms of Use</Text></Pressable> : null}
        </ScrollView>
        <View style={st.foot}>
          <Text style={st.small}>By continuing you agree that you use Channel Nav at your own risk and remain responsible for your vessel and crew.</Text>
          <Pressable onPress={accept} style={st.btn} accessibilityRole="button"><Text style={st.btnT}>I understand and agree</Text></Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  wrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.bg, zIndex: 200 },
  body: { padding: 22, gap: 14, paddingBottom: 30 },
  h1: { color: colors.text, fontSize: 28, fontWeight: '800', textAlign: 'center' },
  sub: { color: colors.muted, fontSize: 15, textAlign: 'center', marginBottom: 6 },
  row: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  icon: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.accent + '22', alignItems: 'center', justifyContent: 'center' },
  t: { color: colors.text, fontSize: 16, fontWeight: '800' },
  p: { color: colors.muted, fontSize: 14.5, lineHeight: 20, marginTop: 2 },
  link: { color: colors.live, fontWeight: '700', textAlign: 'center', marginTop: 6 },
  foot: { padding: 18, gap: 10, borderTopWidth: 1, borderColor: colors.line },
  small: { color: colors.muted, fontSize: 12.5, textAlign: 'center' },
  btn: { backgroundColor: colors.accent, borderRadius: 14, minHeight: 54, alignItems: 'center', justifyContent: 'center' },
  btnT: { color: colors.accentInk, fontSize: 17, fontWeight: '800' },
}));
