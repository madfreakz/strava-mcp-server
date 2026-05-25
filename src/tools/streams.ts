import { z } from 'zod';
import { getActivityStreams } from '../client';
import { STREAM_MAX_POINTS } from '../constants';
import { errorText } from './activities';

const STREAM_KEYS = ['time', 'distance', 'heartrate', 'velocity_smooth', 'altitude', 'cadence', 'latlng', 'watts', 'grade_smooth'] as const;

export const getRunStreamsInputSchema = {
  activity_id: z.number().int().positive()
    .describe('Strava activity ID.'),
  keys: z.array(z.enum(STREAM_KEYS)).default(['time', 'heartrate', 'velocity_smooth', 'distance'])
    .describe('Which streams to fetch. Defaults to the four most useful for trend analysis.'),
  max_points: z.number().int().min(50).max(STREAM_MAX_POINTS).default(STREAM_MAX_POINTS)
    .describe('Downsample each stream to this many points by uniform stride.'),
};

export function downsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  if (maxPoints < 2) return arr.length > 0 ? [arr[0]] : [];
  const stride = (arr.length - 1) / (maxPoints - 1);
  const out: T[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round(i * stride);
    out.push(arr[Math.min(idx, arr.length - 1)]);
  }
  return out;
}

export async function getRunStreams(args: {
  activity_id: number;
  keys: string[];
  max_points: number;
}): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const raw = await getActivityStreams(args.activity_id, args.keys);
    const downsampled: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw as Record<string, { data: unknown[]; original_size?: number; resolution?: string }>)) {
      if (v && Array.isArray(v.data)) {
        downsampled[k] = {
          original_size: v.original_size ?? v.data.length,
          downsampled_size: Math.min(v.data.length, args.max_points),
          resolution: v.resolution,
          data: downsample(v.data, args.max_points),
        };
      }
    }
    return { content: [{ type: 'text', text: JSON.stringify(downsampled, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: errorText('get_run_streams', err) }] };
  }
}
