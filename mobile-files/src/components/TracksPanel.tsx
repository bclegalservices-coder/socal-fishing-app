import { Text, View } from 'react-native';
import { colors } from '../theme';
import { formatNm } from '../geo';
import { formatDuration, trackStats, type TrackPoint } from '../nav';
import type { ActiveTrack, TrackMeta } from '../storage';
import { Btn, Note, Row, Sheet, Stat, Title } from './ui';

export function TracksPanel({ active, activePts, tracks, onStart, onStop, onShow, onDelete, onClose }: {
  active: ActiveTrack | null; activePts: TrackPoint[]; tracks: TrackMeta[];
  onStart: () => void; onStop: () => void; onShow: (t: TrackMeta) => void; onDelete: (t: TrackMeta) => void; onClose: () => void;
}) {
  const st = trackStats(activePts);
  return (
    <Sheet>
      <Title>Tracks</Title>
      {active ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.alert, fontWeight: '700' }}>● Recording {active.mode === 'background' ? '(keeps going with the screen off)' : '(only while the app is open)'}</Text>
          <Row>
            <Stat k="Distance" v={`${formatNm(st.distanceNm)} NM`} />
            <Stat k="Time" v={formatDuration(st.durationMin)} />
            <Stat k="Max" v={`${st.maxKt.toFixed(1)} kt`} />
          </Row>
          <Row><Btn label="Stop and save" kind="danger" onPress={onStop} /><Btn label="Close" onPress={onClose} /></Row>
        </View>
      ) : (
        <Row><Btn label="Start recording" kind="primary" onPress={onStart} /><Btn label="Close" onPress={onClose} /></Row>
      )}
      {!tracks.length ? <Note>No saved tracks yet. Recorded trips are saved on this phone and work offline.</Note> : null}
      {tracks.map((t) => (
        <View key={t.id} style={{ gap: 6, paddingVertical: 6, borderTopWidth: 1, borderColor: colors.line }}>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>{t.name}</Text>
          <Note>{formatNm(t.distanceNm)} NM · {formatDuration((t.endedAt - t.startedAt) / 60000)} · max {t.maxKt.toFixed(1)} kt · avg {t.avgMovingKt.toFixed(1)} kt moving</Note>
          <Row><Btn label="Show on map" onPress={() => onShow(t)} /><Btn label="Delete" kind="danger" onPress={() => onDelete(t)} /></Row>
        </View>
      ))}
    </Sheet>
  );
}
