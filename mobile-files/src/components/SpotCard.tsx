import { Text } from 'react-native';
import { colors } from '../theme';
import { bearingTrue, distanceNm, formatLatLon, formatNm } from '../geo';
import type { Pt } from '../nav';
import { Btn, Note, Row, Sheet, Stat, Title } from './ui';
import { ConditionsView } from './ConditionsView';
import { PresentedBy } from '../ads/Sponsor';

type Props = {
  spot: Pt & { subtitle?: string; sponsor?: string; sponsorTags?: string[] }; boat: Pt | null; kind: 'spot' | 'pin' | 'saved';
  onGo: () => void; onAddToRoute: () => void; onSave?: () => void; onDelete?: () => void; onClose: () => void; onLog?: () => void; onWeather?: () => void; onShareToGroup?: () => void; protectedHere?: any[];
};

export function SpotCard({ spot, boat, kind, onGo, onAddToRoute, onSave, onDelete, onClose, onLog, onWeather, onShareToGroup, protectedHere }: Props) {
  const d = boat ? distanceNm(boat.lat, boat.lon, spot.lat, spot.lon) : null;
  const b = boat ? bearingTrue(boat.lat, boat.lon, spot.lat, spot.lon) : null;
  return (
    <Sheet maxHeight={620}>
      {kind === 'pin' ? <Text style={{ color: colors.live, fontWeight: '600' }}>Dropped pin</Text> : <Title>{spot.name}</Title>}
      {spot.subtitle ? <Note>{spot.subtitle}</Note> : null}
      {protectedHere?.length ? (
        <Text style={{ color: colors.alert, backgroundColor: colors.alertBg, borderColor: colors.alert, borderWidth: 1, borderRadius: 10, padding: 8, fontWeight: '700' }}>
          {protectedHere[0].properties?.take === 'no_take' ? '⛔' : '⚠'} Inside {protectedHere[0].properties?.name ?? 'a protected area'}: {protectedHere[0].properties?.rule}
        </Text>
      ) : null}
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{formatLatLon(spot.lat, spot.lon)}</Text>
      <Row>
        <Stat k="Distance" v={d != null ? `${formatNm(d)} NM` : 'No GPS'} />
        <Stat k="Bearing" v={b != null ? `${Math.round(b)}°T` : '—'} />
      </Row>
      <Row>
        <Btn label="Go to" icon="navigate" kind="primary" onPress={onGo} />
        <Btn label="Add to route" icon="git-commit-outline" onPress={onAddToRoute} />
      </Row>
      <Row>
        {onSave ? <Btn label="Save spot" icon="bookmark-outline" onPress={onSave} /> : null}
        {onDelete ? <Btn label="Delete" icon="trash-outline" kind="danger" onPress={onDelete} /> : null}
        <Btn label="Close" icon="close" onPress={onClose} />
      </Row>
      {onLog ? <Btn label="Log a catch here" icon="fish-outline" onPress={onLog} /> : null}
      {onShareToGroup ? <Btn label="Send to my crew" icon="megaphone-outline" onPress={onShareToGroup} /> : null}
      {onWeather ? <Btn label="5-day weather for this spot" icon="partly-sunny-outline" onPress={onWeather} /> : null}
      <ConditionsView lat={spot.lat} lon={spot.lon} />
      {spot.sponsor ? <PresentedBy section={spot.sponsor} tags={spot.sponsorTags} /> : null}
    </Sheet>
  );
}
