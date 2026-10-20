import { Text } from 'react-native';
import { ageText } from '../api';
import { colors } from '../theme';
import { Btn, Note, Row, Sheet, Stat, Title } from './ui';

const dir = (d?: number | null) => (d == null ? '' : ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(d / 22.5) % 16]);

export function BuoyCard({ p, onClose }: { p: any; onClose: () => void }) {
  return (
    <Sheet>
      <Title>Buoy {p.id}</Title>
      <Note>{p.name} · NOAA NDBC · measured, {ageText(p.observed_at)}</Note>
      <Row>
        <Stat k="Wind" v={p.wind_kt != null ? `${dir(p.wind_dir)} ${Math.round(p.wind_kt)} kt` : '—'} />
        <Stat k="Gusts" v={p.gust_kt != null ? `${Math.round(p.gust_kt)} kt` : '—'} />
        <Stat k="Water" v={p.water_f != null ? `${p.water_f}°F` : '—'} />
      </Row>
      <Row>
        <Stat k="Waves" v={p.wave_ft != null ? `${p.wave_ft} ft` : '—'} />
        <Stat k="Period" v={p.dominant_period_s != null ? `${p.dominant_period_s} s` : '—'} />
        <Stat k="From" v={dir(p.wave_dir) || '—'} />
      </Row>
      <Text style={{ color: colors.muted, fontSize: 11 }}>Real measurements at this buoy, not a forecast.</Text>
      <Btn label="Close" onPress={onClose} />
    </Sheet>
  );
}
