import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SyncState } from '../types';

// Direct test of the load/save pattern used by obsidian.ts.
// We replicate the same helper shape inline because the originals are private.
function loadSyncState(p: string): SyncState | null {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')) as SyncState;
  } catch { return null; }
  return null;
}

function saveSyncState(p: string, state: SyncState): void {
  fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf-8');
}

describe('sync state round-trip', () => {
  let tmpDir: string;
  let statePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-sync-test-'));
    statePath = path.join(tmpDir, '.strava-sync-state.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when state file does not exist', () => {
    expect(loadSyncState(statePath)).toBeNull();
  });

  it('round-trips a sync state', () => {
    const state: SyncState = {
      last_synced_start_date: '2026-05-24T14:00:00Z',
      last_sync_at: '2026-05-25T07:00:00Z',
      total_runs_synced: 42,
    };
    saveSyncState(statePath, state);
    const loaded = loadSyncState(statePath);
    expect(loaded).toEqual(state);
  });

  it('returns null on corrupted JSON instead of throwing', () => {
    fs.writeFileSync(statePath, '{ this is not valid json', 'utf-8');
    expect(loadSyncState(statePath)).toBeNull();
  });

  it('overwrites previous state on save', () => {
    saveSyncState(statePath, {
      last_synced_start_date: '2026-01-01T00:00:00Z',
      last_sync_at: '2026-01-01T00:00:00Z',
      total_runs_synced: 1,
    });
    saveSyncState(statePath, {
      last_synced_start_date: '2026-05-24T00:00:00Z',
      last_sync_at: '2026-05-25T00:00:00Z',
      total_runs_synced: 50,
    });
    const loaded = loadSyncState(statePath);
    expect(loaded?.total_runs_synced).toBe(50);
    expect(loaded?.last_synced_start_date).toBe('2026-05-24T00:00:00Z');
  });
});
