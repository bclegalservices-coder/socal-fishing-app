// If a screen crashes, show a calm "Something went wrong" page with a Try again button instead of a dead app,
// and report the error (see errors.ts).
import { Component, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { reportError } from '../errors';

type State = { err: Error | null };
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { err: null };
  static getDerivedStateFromError(err: Error): State { return { err }; }
  componentDidCatch(err: Error, info: any) { reportError(Object.assign(err, { stack: `${err.stack ?? ''}\n--- component ---${info?.componentStack ?? ''}` }), 'screen'); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <View style={{ flex: 1, backgroundColor: '#0A141C', alignItems: 'center', justifyContent: 'center', padding: 30, gap: 14 }}>
        <Text style={{ fontSize: 44 }}>🎣</Text>
        <Text style={{ color: '#EAF0F4', fontSize: 22, fontWeight: '800', textAlign: 'center' }}>Something went wrong</Text>
        <Text style={{ color: '#A3B4C1', fontSize: 15, textAlign: 'center' }}>We've been sent a report automatically. Your spots, tracks and catches are safe on this phone.</Text>
        <Pressable onPress={() => this.setState({ err: null })} style={{ backgroundColor: '#F5A524', borderRadius: 12, paddingHorizontal: 26, paddingVertical: 13, marginTop: 8 }}>
          <Text style={{ color: '#10161B', fontWeight: '800', fontSize: 16 }}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

/** Wall around one map layer (wind, radar, harbors…): if it breaks, that layer quietly disappears, the rest of the
 *  map keeps working, and we get a report. It tries again when its `resetKey` changes (e.g. the layer is toggled). */
export class SafeLayer extends Component<{ name: string; resetKey?: string; children: ReactNode }, State & { key?: string }> {
  state: State & { key?: string } = { err: null, key: this.props.resetKey };
  static getDerivedStateFromError(err: Error) { return { err }; }
  static getDerivedStateFromProps(p: { resetKey?: string }, s: State & { key?: string }) {
    return p.resetKey !== s.key ? { err: null, key: p.resetKey } : null;
  }
  componentDidCatch(err: Error) { reportError(err, `layer:${this.props.name}`); }
  render() { return this.state.err ? null : this.props.children; }
}
