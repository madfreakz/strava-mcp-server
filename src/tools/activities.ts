import { z } from 'zod';
import { getActivity, getActivityZones, listActivities } from '../client';
import { DEFAULT_PER_PAGE, MAX_PER_PAGE } from '../constants';
import { StravaActivitySummary } from '../types';
import { wasRunnaWorkout } from './runna';

const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);

function isRun(act: StravaActivitySummary): boolean {
  return RUN_TYPES.has(act.type) || (act.sport_type ? RUN_TYPES.has(act.sport_type) : false);
}

export const listRecentRunsInputSchema = {
  per_page: z.number().int().min(1).max(MAX_PER_PAGE).default(DEFAULT_PER_PAGE)
    .describe('Activities per Strava page (max 200). Note: filter to runs happens after fetch, so per_page=200 may yield fewer runs.'),
  page: z.number().int().min(1).default(1)
    .describe('Page number (1-based).'),
  after: z.string().datetime().optional()
    .describe('ISO 8601 datetime — only return activities after this time (e.g. "2026-01-01T00:00:00Z").'),
  before: z.string().datetime().optional()
    .describe('ISO 8601 datetime — only return activities before this time.'),
};

export async function listRecentRuns(args: {
  per_page: number;
  page: number;
  after?: string;
  before?: string;
}): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const params: Record<string, number> = { per_page: args.per_page, page: args.page };
    if (args.after) params.after = Math.floor(new Date(args.after).getTime() / 1000);
    if (args.before) params.before = Math.floor(new Date(args.before).getTime() / 1000);
    const all = await listActivities(params);
    const runs = all.filter(isRun).map(a => ({
      id: a.id,
      name: a.name,
      type: a.type,
      sport_type: a.sport_type,
      start_date: a.start_date,
      distance_m: a.distance,
      distance_mi: +(a.distance / 1609.34).toFixed(2),
      moving_time_s: a.moving_time,
      moving_time_fmt: formatDuration(a.moving_time),
      avg_pace_per_mi: a.average_speed ? formatPace(1609.34 / a.average_speed) : null,
      avg_hr: a.average_heartrate ?? null,
      max_hr: a.max_heartrate ?? null,
      elevation_gain_m: a.total_elevation_gain,
      is_runna: wasRunnaWorkout(a).is_runna,
    }));
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ count: runs.length, total_fetched: all.length, runs }, null, 2),
      }],
    };
  } catch (err) {
    return { content: [{ type: 'text', text: errorText('list_recent_runs', err) }] };
  }
}

export const getRunInputSchema = {
  activity_id: z.number().int().positive()
    .describe('Strava activity ID (the number at the end of strava.com/activities/{id}).'),
  include_zones: z.boolean().default(true)
    .describe('Also fetch HR/pace zone distribution for the activity.'),
};

export async function getRun(args: {
  activity_id: number;
  include_zones: boolean;
}): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const detail = await getActivity(args.activity_id, true);
    let zones: unknown = null;
    if (args.include_zones) {
      try { zones = await getActivityZones(args.activity_id); } catch { /* zones optional */ }
    }
    const runna = wasRunnaWorkout(detail);
    const formatted = {
      id: detail.id,
      name: detail.name,
      type: detail.type,
      sport_type: detail.sport_type,
      start_date: detail.start_date,
      start_date_local: detail.start_date_local,
      description: detail.description,
      distance_m: detail.distance,
      distance_mi: +(detail.distance / 1609.34).toFixed(2),
      moving_time_s: detail.moving_time,
      moving_time_fmt: formatDuration(detail.moving_time),
      elapsed_time_s: detail.elapsed_time,
      avg_pace_per_mi: detail.average_speed ? formatPace(1609.34 / detail.average_speed) : null,
      avg_speed_ms: detail.average_speed,
      max_speed_ms: detail.max_speed,
      avg_hr: detail.average_heartrate ?? null,
      max_hr: detail.max_heartrate ?? null,
      elevation_gain_m: detail.total_elevation_gain,
      elevation_gain_ft: detail.total_elevation_gain ? Math.round(detail.total_elevation_gain * 3.28084) : null,
      calories: detail.calories,
      device_name: detail.device_name,
      perceived_exertion: detail.perceived_exertion,
      kudos_count: detail.kudos_count,
      runna,
      laps: (detail.laps ?? []).map(l => ({
        lap_index: l.lap_index,
        name: l.name,
        distance_m: l.distance,
        distance_mi: +(l.distance / 1609.34).toFixed(2),
        moving_time_s: l.moving_time,
        moving_time_fmt: formatDuration(l.moving_time),
        avg_pace_per_mi: l.average_speed ? formatPace(1609.34 / l.average_speed) : null,
        avg_hr: l.average_heartrate ?? null,
        max_hr: l.max_heartrate ?? null,
        elevation_gain_m: l.total_elevation_gain,
        pace_zone: l.pace_zone,
      })),
      zones,
      strava_url: `https://www.strava.com/activities/${detail.id}`,
    };
    return { content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: errorText('get_run', err) }] };
  }
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatPace(secondsPerMile: number): string {
  if (!Number.isFinite(secondsPerMile) || secondsPerMile <= 0) return '0:00';
  const m = Math.floor(secondsPerMile / 60);
  const s = Math.round(secondsPerMile % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function errorText(toolName: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `Error in ${toolName}: ${msg}`;
}
