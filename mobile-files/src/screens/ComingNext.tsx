// Honest placeholder for tabs whose screens arrive in the next build (no fake buttons).
import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, makeStyles } from '../theme';

export function ComingNext({ title, body }: { title: string; body: string }) {
  const st = useSt();
  return (
    <SafeAreaView style={st.root} edges={['top']}>
      <Text style={st.h1}>{title}</Text>
      <Text style={st.p}>{body}</Text>
      <Text style={st.tag}>In the next update</Text>
    </SafeAreaView>
  );
}

const useSt = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 18, gap: 12 },
  h1: { color: colors.text, fontSize: 28, fontWeight: '700', marginTop: 8 },
  p: { color: colors.text, fontSize: 15, lineHeight: 22 },
  tag: { color: colors.accent, fontSize: 13, fontWeight: '700' },
}));
