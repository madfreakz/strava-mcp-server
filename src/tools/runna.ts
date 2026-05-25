import { StravaActivityDetail, StravaActivitySummary, StravaLap, RunnaMetadata } from '../types';

const RUNNA_NAME_RE = /^\s*Runna\b\s*[:\-]/i;
const RUNNA_DESC_RE = /\b(Runna|runna\.com|coached by Runna|Runna app)\b/i;
const INTERVAL_COUNT_RE = /(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(m|mi|km)\b/i;
const PACE_AT_RE = /@\s*(\d{1,2}):(\d{2})/;

function isRunnaActivity(act: { name?: string; description?: string | null; device_name?: string }): boolean {
  if (act.device_name && /^Runna\b/i.test(act.device_name)) return true;
  if (act.name && RUNNA_NAME_RE.test(act.name)) return true;
  if (act.description && RUNNA_DESC_RE.test(act.description)) return true;
  return false;
}

function extractWorkoutTitle(name: string): string {
  return name.replace(RUNNA_NAME_RE, '').trim();
}

function parseIntervalSpec(title: string): { interval_count?: number; work_distance_m?: number } {
  const m = title.match(INTERVAL_COUNT_RE);
  if (!m) return {};
  const count = Number(m[1]);
  const dist = Number(m[2]);
  const unit = m[3].toLowerCase();
  let distM = dist;
  if (unit === 'mi') distM = dist * 1609.34;
  else if (unit === 'km') distM = dist * 1000;
  return { interval_count: count, work_distance_m: Math.round(distM) };
}

function parseTargetPace(title: string): { target_pace_sec_per_mi?: number } {
  const m = title.match(PACE_AT_RE);
  if (!m) return {};
  const sec = Number(m[1]) * 60 + Number(m[2]);
  return { target_pace_sec_per_mi: sec };
}

function classifyLapPattern(laps?: StravaLap[]): 'work-rest' | 'continuous' | 'unknown' {
  if (!laps || laps.length < 3) return 'continuous';
  const distances = laps.map(l => l.distance).filter(d => d > 0);
  if (distances.length < 4) return 'unknown';

  // Count alternations: consecutive delta sign flips. Work/rest alternates; tempo doesn't.
  let alternations = 0;
  for (let i = 1; i < distances.length - 1; i++) {
    const prev = distances[i] - distances[i - 1];
    const next = distances[i + 1] - distances[i];
    if (prev * next < 0) alternations++;
  }
  const interior = distances.length - 2;
  if (alternations >= Math.max(2, Math.floor(interior * 0.6))) return 'work-rest';
  return 'continuous';
}

export function wasRunnaWorkout(act: StravaActivitySummary | StravaActivityDetail): RunnaMetadata {
  if (!isRunnaActivity(act)) return { is_runna: false };
  const workout_title = act.name ? extractWorkoutTitle(act.name) : undefined;
  // Pull interval spec from the activity name, or from the first non-empty description line if name is plain
  const titleSource = workout_title && INTERVAL_COUNT_RE.test(workout_title)
    ? workout_title
    : (act.description ?? workout_title ?? '');
  const intervalSpec = parseIntervalSpec(titleSource);
  const paceSpec = parseTargetPace(titleSource);
  const laps = (act as StravaActivityDetail).laps;
  const lap_pattern = classifyLapPattern(laps);
  return {
    is_runna: true,
    workout_title,
    lap_pattern,
    ...intervalSpec,
    ...paceSpec,
  };
}
