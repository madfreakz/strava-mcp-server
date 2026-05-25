export interface StravaTokens {
  client_id: string;
  client_secret: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete_id?: number;
  scope?: string;
}

export interface StravaAthlete {
  id: number;
  username?: string;
  firstname?: string;
  lastname?: string;
  city?: string;
  state?: string;
  country?: string;
  sex?: string;
  weight?: number;
  measurement_preference?: string;
  ftp?: number | null;
}

export interface StravaAthleteStats {
  biggest_ride_distance?: number;
  biggest_climb_elevation_gain?: number;
  recent_run_totals?: StravaTotals;
  recent_ride_totals?: StravaTotals;
  ytd_run_totals?: StravaTotals;
  ytd_ride_totals?: StravaTotals;
  all_run_totals?: StravaTotals;
  all_ride_totals?: StravaTotals;
}

export interface StravaTotals {
  count: number;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  elevation_gain: number;
  achievement_count?: number;
}

export interface StravaLap {
  id: number;
  name: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  start_index?: number;
  end_index?: number;
  total_elevation_gain?: number;
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  average_cadence?: number | null;
  lap_index: number;
  split?: number;
  pace_zone?: number;
}

export interface StravaActivitySummary {
  id: number;
  name: string;
  type: string;
  sport_type?: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  start_date: string;
  start_date_local?: string;
  timezone?: string;
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  has_heartrate?: boolean;
  workout_type?: number | null;
  achievement_count?: number;
  kudos_count?: number;
  athlete_count?: number;
  trainer?: boolean;
  commute?: boolean;
  manual?: boolean;
  description?: string | null;
}

export interface StravaActivityDetail extends StravaActivitySummary {
  calories?: number;
  laps?: StravaLap[];
  splits_metric?: unknown[];
  splits_standard?: unknown[];
  best_efforts?: unknown[];
  device_name?: string;
  embed_token?: string;
  perceived_exertion?: number | null;
  prefer_perceived_exertion?: boolean | null;
  description?: string | null;
}

export interface StravaStreamSet {
  time?: StravaStream<number>;
  distance?: StravaStream<number>;
  heartrate?: StravaStream<number>;
  velocity_smooth?: StravaStream<number>;
  altitude?: StravaStream<number>;
  cadence?: StravaStream<number>;
  latlng?: StravaStream<[number, number]>;
  watts?: StravaStream<number>;
  moving?: StravaStream<boolean>;
  grade_smooth?: StravaStream<number>;
}

export interface StravaStream<T> {
  data: T[];
  original_size?: number;
  resolution?: string;
  series_type?: string;
}

export interface StravaActivityZones {
  type: string;
  score?: number;
  distribution_buckets?: Array<{ min: number; max: number; time: number }>;
  sensor_based?: boolean;
  points?: number;
  custom_zones?: boolean;
  max?: number;
}

export interface RunnaMetadata {
  is_runna: boolean;
  workout_title?: string;
  interval_count?: number;
  work_distance_m?: number;
  rest_distance_m?: number;
  target_pace_sec_per_mi?: number;
  lap_pattern?: 'work-rest' | 'continuous' | 'unknown';
}

export interface SyncState {
  last_synced_start_date: string | null;
  last_sync_at: string;
  total_runs_synced: number;
}

export interface SyncedRunRecord {
  id: number;
  start_date: string;
  start_date_local: string;
  name: string;
  type: string;
  distance: number;
  moving_time: number;
  average_heartrate?: number | null;
  is_runna: boolean;
  filename: string;
}
