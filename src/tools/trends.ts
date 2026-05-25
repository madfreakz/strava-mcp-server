import { z } from 'zod';
import { listActivities } from '../client';
import { errorText, formatDuration, formatPace } from './activities';
import { wasRunnaWorkout } from './runna';
import { StravaActivitySummary } from '../types';

const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);
const EASY_HR_PCT = 0.75;  // < 75% of max HR = easy
const FETCH_PAGES_PER_WINDOW = 4;
const FETCH_PER_PAGE = 100;

export const analyzeRecentTrendsInputSchema = {
  weeks: z.number().int().min(1).max(52).default(8)
    .describe('Number of recent weeks (rolling from today) to analyze.'),
  est_max_hr: z.number().int().min(120).max(220).optional()
    .describe('Estimated max HR for easy/hard classification (defaults to 220 - age if unknown; falls back to 190).'),
};

function isRun(act: StravaActivitySummary): boolean {
  return RUN_TYPES.has(act.type) || (act.sport_type ? RUN_TYPES.has(act.sport_type) : false);
}

function weekKey(d: Date): string {
  // ISO week-ish: anchor each Monday
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

export async function analyzeRecentTrends(args: {
  weeks: number;
  est_max_hr?: number;
}): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const afterUnix = Math.floor(Date.now() / 1000) - args.weeks * 7 * 86400;
    const all: StravaActivitySummary[] = [];
    for (let page = 1; page <= FETCH_PAGES_PER_WINDOW; page++) {
      const batch = await listActivities({ per_page: FETCH_PER_PAGE, page, after: afterUnix });
      if (batch.length === 0) break;
      all.push(...batch);
      if (batch.length < FETCH_PER_PAGE) break;
    }
    const runs = all.filter(isRun);
    if (runs.length === 0) {
      return { content: [{ type: 'text', text: JSON.stringify({ message: `No runs in the last ${args.weeks} weeks.` }, null, 2) }] };
    }

    const maxHr = args.est_max_hr ?? 190;
    const easyThreshold = maxHr * EASY_HR_PCT;

    // Group by week
    const byWeek = new Map<string, StravaActivitySummary[]>();
    for (const r of runs) {
      const k = weekKey(new Date(r.start_date));
      if (!byWeek.has(k)) byWeek.set(k, []);
      byWeek.get(k)!.push(r);
    }

    const weeklyMileage = [...byWeek.entries()]
      .map(([week, rs]) => {
        const distance_m = rs.reduce((s, r) => s + r.distance, 0);
        const moving_time_s = rs.reduce((s, r) => s + r.moving_time, 0);
        const totalDistWithHr = rs.filter(r => r.average_heartrate != null && r.distance > 0);
        const wAvgHr = totalDistWithHr.length
          ? totalDistWithHr.reduce((s, r) => s + (r.average_heartrate as number) * r.distance, 0) /
            totalDistWithHr.reduce((s, r) => s + r.distance, 0)
          : null;
        return {
          week_starting: week,
          run_count: rs.length,
          distance_mi: +(distance_m / 1609.34).toFixed(2),
          moving_time_fmt: formatDuration(moving_time_s),
          avg_pace_per_mi: moving_time_s > 0 && distance_m > 0
            ? formatPace((moving_time_s / distance_m) * 1609.34)
            : null,
          weighted_avg_hr: wAvgHr ? +wAvgHr.toFixed(0) : null,
        };
      })
      .sort((a, b) => a.week_starting.localeCompare(b.week_starting));

    const totalDist = runs.reduce((s, r) => s + r.distance, 0);
    const totalTime = runs.reduce((s, r) => s + r.moving_time, 0);
    const longest = runs.reduce((max, r) => r.distance > max.distance ? r : max, runs[0]);
    const runnaCount = runs.filter(r => wasRunnaWorkout(r).is_runna).length;
    const easyRuns = runs.filter(r => r.average_heartrate != null && (r.average_heartrate as number) <= easyThreshold).length;
    const hardRuns = runs.filter(r => r.average_heartrate != null && (r.average_heartrate as number) > easyThreshold).length;
    const noHr = runs.filter(r => r.average_heartrate == null).length;

    // Pace trend (first half vs second half of the window)
    const sorted = [...runs].sort((a, b) => a.start_date.localeCompare(b.start_date));
    const mid = Math.floor(sorted.length / 2);
    const firstHalf = sorted.slice(0, mid);
    const secondHalf = sorted.slice(mid);
    const halfPace = (rs: StravaActivitySummary[]): number | null => {
      const d = rs.reduce((s, r) => s + r.distance, 0);
      const t = rs.reduce((s, r) => s + r.moving_time, 0);
      if (d === 0 || t === 0) return null;
      return (t / d) * 1609.34;
    };
    const p1 = halfPace(firstHalf);
    const p2 = halfPace(secondHalf);
    const paceDeltaSecPerMi = p1 != null && p2 != null ? Math.round(p2 - p1) : null;

    const summary = {
      window_weeks: args.weeks,
      run_count: runs.length,
      runna_workout_count: runnaCount,
      total_distance_mi: +(totalDist / 1609.34).toFixed(1),
      total_moving_time: formatDuration(totalTime),
      avg_distance_per_run_mi: +(totalDist / runs.length / 1609.34).toFixed(2),
      longest_run: {
        date: longest.start_date.slice(0, 10),
        name: longest.name,
        distance_mi: +(longest.distance / 1609.34).toFixed(2),
        moving_time_fmt: formatDuration(longest.moving_time),
        strava_id: longest.id,
      },
      easy_vs_hard_split: {
        easy_run_count: easyRuns,
        hard_run_count: hardRuns,
        no_hr_run_count: noHr,
        easy_threshold_hr: Math.round(easyThreshold),
        est_max_hr: maxHr,
        note: `Easy = avg HR <= ${(EASY_HR_PCT * 100).toFixed(0)}% of est max HR.`,
      },
      pace_trend: {
        first_half_pace_per_mi: p1 != null ? formatPace(p1) : null,
        second_half_pace_per_mi: p2 != null ? formatPace(p2) : null,
        delta_sec_per_mi: paceDeltaSecPerMi,
        interpretation: paceDeltaSecPerMi == null
          ? 'insufficient data'
          : paceDeltaSecPerMi < -10 ? 'getting faster'
          : paceDeltaSecPerMi > 10 ? 'slowing down'
          : 'roughly flat',
      },
      weekly_mileage: weeklyMileage,
    };
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: errorText('analyze_recent_trends', err) }] };
  }
}
