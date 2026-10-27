// Pro (Oct 27). The ONLY thing that will ever be Pro: spotter planes — circling / likely-spotter highlights, their
// loops, the "planes circling" banner and spotter-plane push alerts. Plain air traffic stays free.
// The switch is Admin → Settings → spotter_premium. While it's off (now), everyone gets spotter planes free and
// they're marked "PRO · free for now". Pro status comes from the `subscriptions` table (tier 'pro', status 'active',
// not expired) — later filled by Apple / Google in-app purchases.
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { currentConfig, onConfig } from './appConfig';
import { supabase, supabaseReady } from './supabase';

export type ProState = { gated: boolean; pro: boolean; locked: boolean };

let proCache: { at: number; pro: boolean } = { at: 0, pro: false };

async function checkPro(): Promise<boolean> {
  if (!supabaseReady) return false;
  if (Date.now() - proCache.at < 10 * 60000) return proCache.pro;
  try {
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) { proCache = { at: Date.now(), pro: false }; return false; }
    const { data } = await supabase.from('subscriptions').select('tier, status, expires_at').eq('user_id', s.session.user.id).maybeSingle();
    const pro = !!data && data.tier === 'pro' && data.status === 'active' && (!data.expires_at || new Date(data.expires_at).getTime() > Date.now());
    proCache = { at: Date.now(), pro };
    return pro;
  } catch {
    return proCache.pro;
  }
}

export function usePro(): ProState {
  const [gated, setGated] = useState(!!currentConfig().spotter_premium);
  const [pro, setPro] = useState(proCache.pro);
  useEffect(() => {
    const off = onConfig((c) => setGated(!!c.spotter_premium));
    const run = () => { checkPro().then(setPro).catch(() => {}); };
    run();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') run(); });
    const auth = supabaseReady ? supabase.auth.onAuthStateChange(() => { proCache.at = 0; run(); }) : null;
    return () => { off(); sub.remove(); auth?.data.subscription.unsubscribe(); };
  }, []);
  return { gated, pro, locked: gated && !pro };
}
