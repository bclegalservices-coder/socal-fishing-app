// Group push notifications: "Come to me" pings, shared positions/spots/catches, invites and overdue alerts.
// Tapping a ping opens the map with Go To already running to that position.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export type GroupOpen =
  | { type: 'goto'; lat: number; lon: number; label: string; kind: string }
  | { type: 'show'; lat: number; lon: number; label: string; kind: string }
  | { type: 'groups'; groupId?: string }
  | { type: 'spotter'; lat: number; lon: number; hex: string; label: string };

/** What tapping a notification should do (pure — tested). */
export function routeNotification(data: any): GroupOpen | null {
  if (!data || typeof data !== 'object') return null;
  if (data.type === 'spotter' && typeof data.lat === 'number' && typeof data.lon === 'number') {
    return { type: 'spotter', lat: data.lat, lon: data.lon, hex: String(data.hex ?? ''), label: data.label ?? 'Spotter plane' };
  }
  if (data.type === 'group_share') {
    const has = typeof data.lat === 'number' && typeof data.lon === 'number';
    if (has && (data.kind === 'ping' || data.kind === 'position' || data.kind === 'overdue')) {
      return { type: 'goto', lat: data.lat, lon: data.lon, label: data.kind === 'overdue' ? `${data.label ?? 'Buddy'} (last known)` : data.label ?? 'Buddy', kind: data.kind };
    }
    if (has) return { type: 'show', lat: data.lat, lon: data.lon, label: data.label ?? 'Shared', kind: data.kind };
    return { type: 'groups', groupId: data.group_id };
  }
  if (data.type === 'group_invite' || data.type === 'group_joined' || data.type === 'float_overdue') return { type: 'groups', groupId: data.group_id };
  return null;
}

let ready = false;
/** Call once at app start. Shows group pushes even while the app is open, and handles taps (also cold starts). */
export function setupGroupNotifications(onOpen: (o: GroupOpen) => void): () => void {
  if (!ready) {
    ready = true;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowAlert: true, shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) as any,
    });
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('groups', {
        name: 'Fishing group', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 150, 250], sound: 'default',
      }).catch(() => {});
    }
  }
  const handle = (r: Notifications.NotificationResponse | null) => {
    const o = routeNotification(r?.notification.request.content.data);
    if (o) onOpen(o);
  };
  Notifications.getLastNotificationResponseAsync().then(handle).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
