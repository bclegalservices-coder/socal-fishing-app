// Track recording. Records in the background (screen off / app closed) when the user allows
// "Always" location; otherwise records only while the app is open.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { distanceNm, msToKnots } from './geo';
import { trackStats, type TrackPoint } from './nav';
import { loadActive, loadTracks, newId, saveActive, saveTrackPoints, saveTracks, type ActiveTrack, type TrackMeta } from './storage';
import { publishPosition, sharingActive } from './community/groupsApi';

export const TRACK_TASK = 'track-recorder';
export const SHARE_TASK = 'group-share';

// Must run at app start (this file is imported by App.tsx) so iOS/Android can wake the task.
TaskManager.defineTask(TRACK_TASK, async ({ data, error }: any) => {
  if (error || !data?.locations) return;
  const locs = data.locations as Location.LocationObject[];
  await appendLocations(locs);
  // keep buddies updated with the screen off (only if sharing is on; throttled to every 45 s)
  const l = locs[locs.length - 1];
  if (l) publishPosition({ lat: l.coords.latitude, lon: l.coords.longitude, sog: l.coords.speed != null && l.coords.speed >= 0 ? msToKnots(l.coords.speed) : null,
    cog: l.coords.heading != null && l.coords.heading >= 0 ? l.coords.heading : null, acc: l.coords.accuracy ?? null }).catch(() => {});
});

// Low-power updates that keep your fishing group current while you share and the phone is in your pocket.
// Stops itself as soon as sharing ends.
TaskManager.defineTask(SHARE_TASK, async ({ data, error }: any) => {
  if (error || !data?.locations) return;
  if (!(await sharingActive())) { stopShareUpdates().catch(() => {}); return; }
  const l = (data.locations as Location.LocationObject[]).slice(-1)[0];
  if (l) await publishPosition({ lat: l.coords.latitude, lon: l.coords.longitude, sog: l.coords.speed != null && l.coords.speed >= 0 ? msToKnots(l.coords.speed) : null,
    cog: l.coords.heading != null && l.coords.heading >= 0 ? l.coords.heading : null, acc: l.coords.accuracy ?? null }).catch(() => {});
});

/** Call when sharing starts. Returns false when background location isn't allowed (then it updates only while the app is open). */
export async function startShareUpdates(): Promise<boolean> {
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') return false;
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== 'granted') return false;
    if (await Location.hasStartedLocationUpdatesAsync(SHARE_TASK).catch(() => false)) return true;
    await Location.startLocationUpdatesAsync(SHARE_TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 150,          // ~0.1 NM
      timeInterval: 60000,
      deferredUpdatesInterval: 60000,
      activityType: Location.ActivityType.OtherNavigation,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: { notificationTitle: 'Sharing your boat with your group', notificationBody: 'Turns off by itself when sharing ends' },
    });
    return true;
  } catch { return false; }
}
export async function stopShareUpdates() {
  if (await Location.hasStartedLocationUpdatesAsync(SHARE_TASK).catch(() => false)) await Location.stopLocationUpdatesAsync(SHARE_TASK).catch(() => {});
}

/** Adds GPS fixes to the active track, skipping noisy or duplicate points. */
export async function appendLocations(locs: Location.LocationObject[]) {
  const active = await loadActive();
  if (!active) return;
  for (const l of locs) {
    const acc = l.coords.accuracy ?? 99;
    if (acc > 50) continue; // too imprecise to record
    const p: TrackPoint = { lat: l.coords.latitude, lon: l.coords.longitude, t: l.timestamp, sog: l.coords.speed != null && l.coords.speed >= 0 ? msToKnots(l.coords.speed) : null };
    const last = active.points[active.points.length - 1];
    if (last) {
      const movedM = distanceNm(last.lat, last.lon, p.lat, p.lon) * 1852;
      if (movedM < 8 && p.t - last.t < 30_000) continue; // barely moved: skip
    }
    active.points.push(p);
  }
  await saveActive(active);
}

export async function startTrack(): Promise<ActiveTrack['mode']> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') throw new Error('Location permission is needed to record a track.');
  let mode: ActiveTrack['mode'] = 'foreground';
  try {
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status === 'granted') mode = 'background';
  } catch { /* fall back to foreground */ }

  await saveActive({ id: newId(), startedAt: Date.now(), mode, points: [] });
  if (mode === 'background') {
    await Location.startLocationUpdatesAsync(TRACK_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      distanceInterval: 10,
      timeInterval: 3000,
      activityType: Location.ActivityType.OtherNavigation,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: { notificationTitle: 'Recording your track', notificationBody: 'Tap to return to the map' },
    });
  }
  return mode;
}

export async function stopTrack(name?: string): Promise<TrackMeta | null> {
  if (await TaskManager.isTaskRegisteredAsync(TRACK_TASK)) {
    await Location.stopLocationUpdatesAsync(TRACK_TASK).catch(() => {});
  }
  const active = await loadActive();
  await saveActive(null);
  if (!active || active.points.length < 2) return null;
  const st = trackStats(active.points);
  const meta: TrackMeta = {
    id: active.id,
    name: name ?? new Date(active.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    startedAt: active.startedAt,
    endedAt: active.points[active.points.length - 1].t,
    distanceNm: st.distanceNm, maxKt: st.maxKt, avgMovingKt: st.avgMovingKt, points: active.points.length,
  };
  await saveTrackPoints(active.id, active.points);
  await saveTracks([meta, ...(await loadTracks())]);
  return meta;
}
