import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

export function useNetwork() {
  const [s, setS] = useState({ online: true, wifi: false });
  useEffect(() => NetInfo.addEventListener((n: any) => setS({ online: !!n.isConnected && n.isInternetReachable !== false, wifi: n.type === 'wifi' })), []);
  return s;
}
export async function onWifi() { const n: any = await NetInfo.fetch(); return n.type === 'wifi' && !!n.isConnected; }
export async function isOnline() { const n: any = await NetInfo.fetch(); return !!n.isConnected && n.isInternetReachable !== false; }
