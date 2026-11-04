// "My boat": the forecast is rated for this boat. Saved on the phone. Nov 4: shared form look (components/form.tsx).
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { Field, FormCard, FormSheet, InfoLine, RadioList, SaveBar, TileGrid } from '../components/form';
import { BOAT_TYPES, COMFORT, type Boat } from './model';

export function BoatSheet({ boat, onSave, onClose }: { boat: Boat; onSave: (b: Boat) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [type, setType] = useState(boat.type);
  const [len, setLen] = useState(boat.length_ft ? String(boat.length_ft) : '');
  const [comfort, setComfort] = useState(boat.comfort);
  const n = Number(len);
  const lenOk = !len || (n >= 6 && n <= 120);
  return (
    <FormSheet title="My boat" hint="The forecast is rated for this boat" onClose={onClose} top={insets.top + 12}
      footer={<SaveBar label="Save" missing={lenOk ? null : 'Enter a length from 6 to 120 ft'} onPress={() => onSave({ type, length_ft: len ? Math.round(n) : null, comfort })}
        secondary={{ label: 'Cancel', onPress: onClose }} />}>
      <FormCard label="Type">
        <TileGrid cols={2} items={BOAT_TYPES.map((t) => ({ key: t.key, label: t.label }))} value={type}
          onChange={(k) => { setType(k); if (!len) setLen(String(BOAT_TYPES.find((t) => t.key === k)?.typical ?? '')); }} />
      </FormCard>
      <FormCard label="Length">
        <View style={{ width: 150 }}><Field value={len} onChangeText={(s: string) => setLen(s.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="23" unit="ft" /></View>
        {!lenOk ? <Text style={{ color: colors.alert, fontSize: 13 }}>Enter a length between 6 and 120 ft.</Text> : null}
      </FormCard>
      <FormCard label="How cautious should the rating be?">
        <RadioList items={COMFORT} value={comfort} onChange={setComfort} />
      </FormCard>
      <InfoLine text="Ratings: 🟢 Comfortable · 🟡 Bumpy · 🟠 Rough · 🔴 Stay in. They use NWS forecast seas, swell period and wind, plus Small Craft Advisory and gale criteria. Planning guidance only: NWS warnings and your own judgment come first." />
    </FormSheet>
  );
}
