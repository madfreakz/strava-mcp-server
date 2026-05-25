import { describe, it, expect } from 'vitest';
import { wasRunnaWorkout } from './runna';
import { StravaActivityDetail } from '../types';

function mkAct(overrides: Partial<StravaActivityDetail>): StravaActivityDetail {
  return {
    id: 1,
    name: 'Morning Run',
    type: 'Run',
    distance: 10000,
    moving_time: 3000,
    elapsed_time: 3000,
    total_elevation_gain: 50,
    start_date: '2026-05-24T14:00:00Z',
    ...overrides,
  };
}

describe('wasRunnaWorkout', () => {
  it('detects Runna activity by name prefix', () => {
    const r = wasRunnaWorkout(mkAct({ name: 'Runna: 6 x 800m @ 5K pace' }));
    expect(r.is_runna).toBe(true);
    expect(r.workout_title).toBe('6 x 800m @ 5K pace');
    expect(r.interval_count).toBe(6);
    expect(r.work_distance_m).toBe(800);
  });

  it('detects Runna with dash separator', () => {
    const r = wasRunnaWorkout(mkAct({ name: 'Runna - Tempo 5 mi' }));
    expect(r.is_runna).toBe(true);
  });

  it('returns false for non-Runna activities', () => {
    const r = wasRunnaWorkout(mkAct({ name: 'Morning Run' }));
    expect(r.is_runna).toBe(false);
    expect(r.workout_title).toBeUndefined();
  });

  it('detects Runna by description marker when name is plain', () => {
    const r = wasRunnaWorkout(mkAct({ name: 'Easy 5k', description: 'Completed via the Runna app' }));
    expect(r.is_runna).toBe(true);
  });

  it('parses km work distance', () => {
    const r = wasRunnaWorkout(mkAct({ name: 'Runna: 5 x 1km' }));
    expect(r.interval_count).toBe(5);
    expect(r.work_distance_m).toBe(1000);
  });

  it('parses mi work distance', () => {
    const r = wasRunnaWorkout(mkAct({ name: 'Runna: 3x1mi @ 7:00' }));
    expect(r.interval_count).toBe(3);
    expect(r.work_distance_m).toBe(1609);  // 1 mi rounded
    expect(r.target_pace_sec_per_mi).toBe(420);  // 7:00 = 420s
  });

  it('parses target pace with @', () => {
    const r = wasRunnaWorkout(mkAct({ name: 'Runna: 4 x 400m @ 6:30' }));
    expect(r.target_pace_sec_per_mi).toBe(390);
  });

  it('classifies work-rest pattern when laps alternate short/long', () => {
    const laps = [
      { distance: 800, lap_index: 1 },
      { distance: 200, lap_index: 2 },
      { distance: 800, lap_index: 3 },
      { distance: 200, lap_index: 4 },
      { distance: 800, lap_index: 5 },
      { distance: 200, lap_index: 6 },
    ].map(l => ({ id: l.lap_index, name: `Lap ${l.lap_index}`, moving_time: 100, elapsed_time: 100, ...l }));
    const r = wasRunnaWorkout(mkAct({ name: 'Runna: 3 x 800m', laps: laps as unknown as StravaActivityDetail['laps'] }));
    expect(r.lap_pattern).toBe('work-rest');
  });

  it('classifies continuous when laps are similar distances', () => {
    const laps = [
      { distance: 1609, lap_index: 1 },
      { distance: 1609, lap_index: 2 },
      { distance: 1609, lap_index: 3 },
      { distance: 1609, lap_index: 4 },
    ].map(l => ({ id: l.lap_index, name: `Mile ${l.lap_index}`, moving_time: 480, elapsed_time: 480, ...l }));
    const r = wasRunnaWorkout(mkAct({ name: 'Runna: 4 mi Tempo', laps: laps as unknown as StravaActivityDetail['laps'] }));
    expect(r.lap_pattern).toBe('continuous');
  });

  it('case-insensitive name match', () => {
    expect(wasRunnaWorkout(mkAct({ name: 'RUNNA: 5k easy' })).is_runna).toBe(true);
    expect(wasRunnaWorkout(mkAct({ name: 'runna: long run' })).is_runna).toBe(true);
  });

  it('detects Runna via device_name on the activity detail', () => {
    const r = wasRunnaWorkout(mkAct({ name: 'Tempo 3-2-1', device_name: 'Runna' }));
    expect(r.is_runna).toBe(true);
  });

  it('parses interval spec from description when name is plain (Runna phone-app pattern)', () => {
    const r = wasRunnaWorkout(mkAct({
      name: '8km Easy Run',
      device_name: 'Runna',
      description: 'San Francisco 2nd Half Marathon Plan (Week 15/24)\n\n3 x 1km at 5:30/km',
    }));
    expect(r.is_runna).toBe(true);
    expect(r.interval_count).toBe(3);
    expect(r.work_distance_m).toBe(1000);
  });
});
