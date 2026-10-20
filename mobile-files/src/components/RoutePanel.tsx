import { Text, View } from 'react-native';
import { colors } from '../theme';
import { formatNm } from '../geo';
import { formatDuration, routeLegs, type Pt } from '../nav';
import type { Route } from '../storage';
import { Btn, Note, Row, Sheet, Title } from './ui';

/** Building a route: tap the map or spots to add points. */
export function RouteDraft({ points, sogKt, onUndo, onSave, onGo, onCancel }: {
  points: Pt[]; sogKt: number | null; onUndo: () => void; onSave: () => void; onGo: () => void; onCancel: () => void;
}) {
  const { legs, totalNm } = routeLegs(points);
  const speed = sogKt && sogKt > 3 ? sogKt : 20;
  return (
    <Sheet maxHeight={420}>
      <Title>New route</Title>
      <Note>Tap the map or a spot to add a point. {points.length < 2 ? 'Add at least 2 points.' : ''}</Note>
      {legs.map((l, i) => (
        <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.text, fontSize: 15 }}>Leg {i + 1}{l.to.name ? ` → ${l.to.name}` : ''}</Text>
          <Text style={{ color: colors.text, fontSize: 15, fontVariant: ['tabular-nums'] }}>{formatNm(l.distanceNm)} NM · {Math.round(l.bearing)}°T</Text>
        </View>
      ))}
      {legs.length ? <Text style={{ color: colors.accent, fontSize: 16, fontWeight: '700' }}>Total {formatNm(totalNm)} NM · about {formatDuration((totalNm / speed) * 60)} at {Math.round(speed)} kt</Text> : null}
      <Note color="#F7DDB0">Your route is straight lines between your points. The app does not check it for land, shallows or closed areas — check the chart.</Note>
      <Row>
        <Btn label="Undo" onPress={onUndo} disabled={!points.length} />
        <Btn label="Save" onPress={onSave} disabled={points.length < 2} />
        <Btn label="Go" kind="primary" onPress={onGo} disabled={points.length < 1} />
      </Row>
      <Btn label="Cancel" onPress={onCancel} />
    </Sheet>
  );
}

/** Saved routes list. */
export function RoutesList({ routes, onNew, onGo, onShow, onDelete, onClose }: {
  routes: Route[]; onNew: () => void; onGo: (r: Route) => void; onShow: (r: Route) => void; onDelete: (r: Route) => void; onClose: () => void;
}) {
  return (
    <Sheet>
      <Title>Routes</Title>
      <Row><Btn label="New route" kind="primary" onPress={onNew} /><Btn label="Close" onPress={onClose} /></Row>
      {!routes.length ? <Note>No saved routes yet. Build one with New route, or tap a spot and choose Add to route.</Note> : null}
      {routes.map((r) => {
        const { totalNm, legs } = routeLegs(r.points);
        return (
          <View key={r.id} style={{ gap: 6, paddingVertical: 6, borderTopWidth: 1, borderColor: colors.line }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>{r.name}</Text>
            <Note>{legs.length} leg{legs.length === 1 ? '' : 's'} · {formatNm(totalNm)} NM</Note>
            <Row><Btn label="Go" kind="primary" onPress={() => onGo(r)} /><Btn label="Show" onPress={() => onShow(r)} /><Btn label="Delete" kind="danger" onPress={() => onDelete(r)} /></Row>
          </View>
        );
      })}
    </Sheet>
  );
}
