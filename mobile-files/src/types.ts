// Shapes returned by the backend. Every value carries its source and age.
export type Kind = 'observed' | 'model' | 'interpolated' | 'prediction' | 'derived' | 'static' | 'forecast';

export type Measurement = {
  type: string; value: number | string | null; unit?: string | null; label?: string | null; kind: Kind;
  source: string; dataset?: string | null; observed_at?: string | null; forecast_for?: string | null;
  retrieved_at: string; resolution_m?: number | null; distance_nm?: number | null; extra?: Record<string, any>;
};
export type Section = { ok: boolean; error?: string | null; items: Measurement[]; data: Record<string, any> };
export type Conditions = {
  lat: number; lon: number; generated_at: string; disclaimer: string;
  water?: Section; depth?: Section; tide?: Section; weather?: Section; waves?: Section; alerts?: Section; nearby?: Section;
  moon?: { phase: number; name: string; illumination: number };
};

export type Legend = { min: number; max: number; log?: boolean; stops: string[]; unit: string; ticks: number[] };
export type LayerDate = { date: string; observed_at?: string | null; tiles: string; breaks?: string; contours?: string; tile_count?: number };
export type GridLayer = {
  key: 'sst' | 'chl' | 'bathy'; available?: boolean; label?: string; note?: string; kind?: Kind; source?: string;
  dataset?: string; resolution_m?: number; legend?: Legend; dates?: LayerDate[]; updated_at?: string;
};
export type WindLayer = { key: 'wind'; available?: boolean; label?: string; note?: string; source?: string; run?: string; hours?: { fh: number; valid: string; url: string }[]; legend?: Legend };
export type ExternalLayer = { key: string; label: string; kind: Kind; source: string; tiles: string; frames?: string[]; frame_minutes_ago?: number[]; refresh_seconds?: number; note?: string };
export type Catalog = { layers: (GridLayer | WindLayer | ExternalLayer)[] };
