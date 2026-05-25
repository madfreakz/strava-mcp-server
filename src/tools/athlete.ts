import { z } from 'zod';
import { getAthlete, getAthleteStats, getAthleteZones } from '../client';
import { errorText, formatDuration } from './activities';

export const getAthleteProfileInputSchema = {};

export async function getAthleteProfile(): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const [athlete, zones] = await Promise.all([
      getAthlete(),
      getAthleteZones().catch(() => null),
    ]);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ athlete, zones }, null, 2),
      }],
    };
  } catch (err) {
    return { content: [{ type: 'text', text: errorText('get_athlete_profile', err) }] };
  }
}

export const getAthleteStatsInputSchema = {};

export async function getAthleteStatsTool(): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const stats = await getAthleteStats();
    const formatTotals = (t?: { count: number; distance: number; moving_time: number; elevation_gain: number }) => {
      if (!t) return null;
      return {
        count: t.count,
        distance_m: t.distance,
        distance_mi: +(t.distance / 1609.34).toFixed(1),
        moving_time_s: t.moving_time,
        moving_time_fmt: formatDuration(t.moving_time),
        elevation_gain_m: t.elevation_gain,
        elevation_gain_ft: Math.round(t.elevation_gain * 3.28084),
      };
    };
    const out = {
      recent_run_totals: formatTotals(stats.recent_run_totals),
      ytd_run_totals: formatTotals(stats.ytd_run_totals),
      all_run_totals: formatTotals(stats.all_run_totals),
      recent_ride_totals: formatTotals(stats.recent_ride_totals),
      ytd_ride_totals: formatTotals(stats.ytd_ride_totals),
      all_ride_totals: formatTotals(stats.all_ride_totals),
    };
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(out)) if (v) cleaned[k] = v;
    return { content: [{ type: 'text', text: JSON.stringify(cleaned, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: errorText('get_athlete_stats', err) }] };
  }
}
