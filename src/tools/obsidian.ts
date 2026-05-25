import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { listActivities, getActivity, getActivityZones } from '../client';
import {
  OBSIDIAN_VAULT_PATH,
  SYNC_DIR_NAME,
  DASHBOARD_NAME,
  SYNC_STATE_FILENAME,
  MANIFEST_FILENAME,
  DEFAULT_SYNC_MAX_RUNS,
} from '../constants';
import { SyncState, SyncedRunRecord, StravaActivityDetail, StravaActivitySummary } from '../types';
import { wasRunnaWorkout } from './runna';
import { formatDuration, formatPace } from './activities';

const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);

function isRun(act: StravaActivitySummary): boolean {
  return RUN_TYPES.has(act.type) || (act.sport_type ? RUN_TYPES.has(act.sport_type) : false);
}

// ---- Atomic JSON file IO ----
// State, manifest, dashboard: all written via tmp + rename. A crash mid-write would
// otherwise corrupt the file, causing the next sync to fall back to a full re-fetch
// (state) or lose every record (manifest).
function atomicWrite(p: string, contents: string): void {
  const tmp = `${p}.${process.pid}.${process.hrtime.bigint().toString(36)}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, contents);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, p);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
}

// ---- Sync state ----
function loadSyncState(p: string): SyncState | null {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')) as SyncState;
  } catch { /* first run */ }
  return null;
}

function saveSyncState(p: string, state: SyncState): void {
  atomicWrite(p, JSON.stringify(state, null, 2));
}

function loadManifest(p: string): SyncedRunRecord[] {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { /* empty */ }
  return [];
}

function saveManifest(p: string, records: SyncedRunRecord[]): void {
  atomicWrite(p, JSON.stringify(records, null, 2));
}

// ---- Helpers ----
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim();
}

// Strict ISO date guard — Strava should always send ISO 8601, but a bad upstream
// (or someone reusing this client for a less-trusted API) could try `../../etc/passwd`.
function safeDate(raw: string | undefined | null): string {
  if (raw && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function runFilename(act: StravaActivitySummary): string {
  const date = safeDate(act.start_date_local ?? act.start_date);
  const slugBase = sanitizeFilename(act.name)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^[.\-]+/, '')      // no leading dots (defeats hidden-file write)
    .replace(/[.\-]+$/, '')      // no trailing dot/dash
    .slice(0, 40)
    .replace(/-+$/, '');
  const filename = `${date}-${slugBase || 'untitled'}.md`;
  // Final guard: filename must not be solely dots or empty
  if (/^\.+(\.md)?$/.test(filename)) return `${date}-untitled.md`;
  return filename;
}

// Ensure resolved path stays inside the runs directory.
function assertInside(filePath: string, runsDir: string): void {
  const resolvedFile = path.resolve(filePath);
  const resolvedDir = path.resolve(runsDir) + path.sep;
  if (!resolvedFile.startsWith(resolvedDir)) {
    throw new Error(`Refusing to write outside runs directory: ${filePath}`);
  }
}

function metersToMiles(m: number): number {
  return +(m / 1609.34).toFixed(2);
}

function speedToPacePerMile(speedMs: number | undefined | null): string | null {
  if (!speedMs || speedMs <= 0) return null;
  return formatPace(1609.34 / speedMs);
}

// ---- Note formatter ----
function formatRunNote(detail: StravaActivityDetail, today: string): string {
  const runna = wasRunnaWorkout(detail);
  const tags = ['running', 'strava'];
  if (runna.is_runna) tags.push('runna');
  else tags.push('unstructured');
  if (detail.type === 'TrailRun') tags.push('trail');

  const localDateStr = safeDate(detail.start_date_local ?? detail.start_date);
  const startDate = new Date(detail.start_date_local ?? detail.start_date);
  const dayOfWeek = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][startDate.getDay()];
  const distanceMi = metersToMiles(detail.distance);
  const movingFmt = formatDuration(detail.moving_time);
  const avgPace = speedToPacePerMile(detail.average_speed);
  const avgPaceSec = detail.average_speed && detail.average_speed > 0
    ? Math.round(1609.34 / detail.average_speed)
    : null;
  const elevationFt = detail.total_elevation_gain ? Math.round(detail.total_elevation_gain * 3.28084) : 0;

  // Frontmatter strings are quoted; numeric fields stay numeric so Dataview can compare them.
  const yamlStr = (v: string) => `"${v.replace(/"/g, '\\"')}"`;
  const lines: string[] = [
    '---',
    `tags: [${tags.join(', ')}]`,
    `date: ${localDateStr}`,
    `day_of_week: ${dayOfWeek}`,
    `distance_mi: ${distanceMi}`,
    `duration: ${yamlStr(movingFmt)}`,
    avgPace ? `avg_pace: ${yamlStr(avgPace)}` : 'avg_pace: null',
    `avg_pace_sec_per_mi: ${avgPaceSec ?? 'null'}`,
    `moving_time_s: ${detail.moving_time}`,
    `avg_hr: ${detail.average_heartrate ?? 'null'}`,
    `max_hr: ${detail.max_heartrate ?? 'null'}`,
    `elevation_gain_ft: ${elevationFt}`,
    `runna_workout: ${runna.is_runna}`,
    `strava_id: ${detail.id}`,
    `created: ${today}`,
    '---',
    '',
    `# ${localDateStr} — ${detail.name.replace(/[\r\n]+/g, ' ').trim()}`,
    '',
    '## Summary',
    `- Distance: ${distanceMi} mi / ${(detail.distance / 1000).toFixed(2)} km`,
    `- Moving time: ${movingFmt}${avgPace ? ` (avg ${avgPace}/mi)` : ''}`,
  ];

  if (detail.average_heartrate != null) {
    lines.push(`- HR: ${Math.round(detail.average_heartrate)} avg / ${detail.max_heartrate ?? '?'} max`);
  }
  lines.push(`- Elevation: +${elevationFt} ft`);
  if (detail.calories) lines.push(`- Calories: ${detail.calories}`);
  if (detail.device_name) lines.push(`- Device: ${detail.device_name}`);
  if (detail.perceived_exertion != null) lines.push(`- Perceived exertion: ${detail.perceived_exertion}/10`);

  if (runna.is_runna) {
    lines.push('', '## Runna Workout');
    if (runna.workout_title) lines.push(`- Title: ${runna.workout_title}`);
    if (runna.interval_count) lines.push(`- Intervals: ${runna.interval_count}${runna.work_distance_m ? ` × ${runna.work_distance_m}m` : ''}`);
    if (runna.target_pace_sec_per_mi) lines.push(`- Target pace: ${formatPace(runna.target_pace_sec_per_mi)}/mi`);
    if (runna.lap_pattern) lines.push(`- Lap pattern: ${runna.lap_pattern}`);
  }

  if (detail.description) {
    lines.push('', '## Description', '', detail.description.trim());
  }

  if (detail.laps && detail.laps.length > 0) {
    lines.push('', '## Laps', '', '| # | Distance | Time | Pace/mi | Avg HR |', '|---|---|---|---|---|');
    for (const lap of detail.laps) {
      const lapMi = metersToMiles(lap.distance);
      const lapTime = formatDuration(lap.moving_time);
      const lapPace = speedToPacePerMile(lap.average_speed) ?? '—';
      const lapHr = lap.average_heartrate != null ? Math.round(lap.average_heartrate) : '—';
      lines.push(`| ${lap.lap_index} | ${lapMi} mi | ${lapTime} | ${lapPace} | ${lapHr} |`);
    }
  }

  lines.push('', `[View on Strava](https://www.strava.com/activities/${detail.id})`, '');
  return lines.join('\n');
}

// ---- Dashboard ----
interface WindowStats {
  runs: number;
  distance_mi: number;
  moving_time_s: number;
  avg_pace_sec_per_mi: number | null;
  avg_hr: number | null;
  runna_count: number;
}

function computeWindow(records: SyncedRunRecord[], startMs: number, endMs: number): WindowStats {
  const subset = records.filter(r => {
    const t = new Date(r.start_date).getTime();
    return t >= startMs && t < endMs;
  });
  const distance_m = subset.reduce((s, r) => s + r.distance, 0);
  const moving_time_s = subset.reduce((s, r) => s + r.moving_time, 0);
  const hrSamples = subset.filter(r => r.average_heartrate != null);
  const avg_hr = hrSamples.length
    ? hrSamples.reduce((s, r) => s + (r.average_heartrate as number), 0) / hrSamples.length
    : null;
  const avg_pace_sec_per_mi = distance_m > 0 && moving_time_s > 0
    ? (moving_time_s / distance_m) * 1609.34
    : null;
  return {
    runs: subset.length,
    distance_mi: +(distance_m / 1609.34).toFixed(2),
    moving_time_s,
    avg_pace_sec_per_mi,
    avg_hr,
    runna_count: subset.filter(r => r.is_runna).length,
  };
}

function formatDelta(curr: number | null, prev: number | null, unit = '', invertColor = false): string {
  if (curr == null || prev == null) return '';
  const delta = curr - prev;
  if (Math.abs(delta) < 0.05) return ' (=)';
  const sign = delta > 0 ? '+' : '';
  const arrow = (delta > 0) !== invertColor ? '▲' : '▼';
  const fmt = unit === 's' ? formatPaceDelta(delta) : `${sign}${delta.toFixed(unit === '%' ? 0 : 1)}${unit}`;
  return ` (${arrow} ${fmt})`;
}

function formatPaceDelta(deltaSec: number): string {
  const sign = deltaSec > 0 ? '+' : '-';
  const abs = Math.abs(deltaSec);
  const m = Math.floor(abs / 60);
  const s = Math.round(abs % 60);
  return m > 0 ? `${sign}${m}:${String(s).padStart(2,'0')}/mi` : `${sign}${s}s/mi`;
}

function formatDashboard(records: SyncedRunRecord[], today: string): string {
  const now = Date.now();
  const day = 86400_000;

  // Two windows for delta comparison: current 7d and prior 7d; current 30d and prior 30d
  const w7now = computeWindow(records, now - 7 * day, now);
  const w7prev = computeWindow(records, now - 14 * day, now - 7 * day);
  const w30now = computeWindow(records, now - 30 * day, now);
  const w30prev = computeWindow(records, now - 60 * day, now - 30 * day);
  const w90now = computeWindow(records, now - 90 * day, now);

  const trendLines = [
    '## This Week vs Last Week',
    '',
    '| Metric | This 7 days | Prior 7 days | Δ |',
    '|---|---|---|---|',
    `| Runs | ${w7now.runs} | ${w7prev.runs} | ${w7now.runs - w7prev.runs >= 0 ? '+' : ''}${w7now.runs - w7prev.runs} |`,
    `| Distance | ${w7now.distance_mi} mi | ${w7prev.distance_mi} mi |${formatDelta(w7now.distance_mi, w7prev.distance_mi, ' mi')} |`,
    `| Avg pace | ${w7now.avg_pace_sec_per_mi ? formatPace(w7now.avg_pace_sec_per_mi) : '—'} | ${w7prev.avg_pace_sec_per_mi ? formatPace(w7prev.avg_pace_sec_per_mi) : '—'} |${formatDelta(w7now.avg_pace_sec_per_mi, w7prev.avg_pace_sec_per_mi, 's', true)} |`,
    `| Avg HR | ${w7now.avg_hr ? w7now.avg_hr.toFixed(0) : '—'} | ${w7prev.avg_hr ? w7prev.avg_hr.toFixed(0) : '—'} |${formatDelta(w7now.avg_hr, w7prev.avg_hr, '')} |`,
    `| Runna | ${w7now.runna_count} | ${w7prev.runna_count} | ${w7now.runna_count - w7prev.runna_count >= 0 ? '+' : ''}${w7now.runna_count - w7prev.runna_count} |`,
    '',
    '## This Month vs Last Month',
    '',
    '| Metric | Last 30 days | Prior 30 days | Δ |',
    '|---|---|---|---|',
    `| Runs | ${w30now.runs} | ${w30prev.runs} | ${w30now.runs - w30prev.runs >= 0 ? '+' : ''}${w30now.runs - w30prev.runs} |`,
    `| Distance | ${w30now.distance_mi} mi | ${w30prev.distance_mi} mi |${formatDelta(w30now.distance_mi, w30prev.distance_mi, ' mi')} |`,
    `| Avg pace | ${w30now.avg_pace_sec_per_mi ? formatPace(w30now.avg_pace_sec_per_mi) : '—'} | ${w30prev.avg_pace_sec_per_mi ? formatPace(w30prev.avg_pace_sec_per_mi) : '—'} |${formatDelta(w30now.avg_pace_sec_per_mi, w30prev.avg_pace_sec_per_mi, 's', true)} |`,
    `| Avg HR | ${w30now.avg_hr ? w30now.avg_hr.toFixed(0) : '—'} | ${w30prev.avg_hr ? w30prev.avg_hr.toFixed(0) : '—'} |${formatDelta(w30now.avg_hr, w30prev.avg_hr, '')} |`,
    `| Runna | ${w30now.runna_count} | ${w30prev.runna_count} | ${w30now.runna_count - w30prev.runna_count >= 0 ? '+' : ''}${w30now.runna_count - w30prev.runna_count} |`,
    '',
  ];

  const rollingLines = [
    '## Rolling Stats',
    '',
    '| Window | Runs | Distance | Avg pace | Avg HR | Runna |',
    '|---|---|---|---|---|---|',
    `| 7 days | ${w7now.runs} | ${w7now.distance_mi} mi | ${w7now.avg_pace_sec_per_mi ? formatPace(w7now.avg_pace_sec_per_mi) : '—'} | ${w7now.avg_hr ? w7now.avg_hr.toFixed(0) : '—'} | ${w7now.runna_count} |`,
    `| 30 days | ${w30now.runs} | ${w30now.distance_mi} mi | ${w30now.avg_pace_sec_per_mi ? formatPace(w30now.avg_pace_sec_per_mi) : '—'} | ${w30now.avg_hr ? w30now.avg_hr.toFixed(0) : '—'} | ${w30now.runna_count} |`,
    `| 90 days | ${w90now.runs} | ${w90now.distance_mi} mi | ${w90now.avg_pace_sec_per_mi ? formatPace(w90now.avg_pace_sec_per_mi) : '—'} | ${w90now.avg_hr ? w90now.avg_hr.toFixed(0) : '—'} | ${w90now.runna_count} |`,
    '',
  ];

  const recent = [...records]
    .sort((a, b) => (b.start_date_local ?? b.start_date).localeCompare(a.start_date_local ?? a.start_date))
    .slice(0, 10);

  const escapePipe = (s: string) => s.replace(/\|/g, '\\|');
  const recentLines = [
    '## Last 10 Runs',
    '',
    '| Date | Name | Distance | Time | Runna |',
    '|---|---|---|---|---|',
    ...recent.map(r => {
      const noteSlug = r.filename.replace(/\.md$/, '');
      const date = (r.start_date_local ?? r.start_date).slice(0, 10);
      return `| ${date} | [[Lifestyle/Runs/${noteSlug}\\|${escapePipe(r.name)}]] | ${(r.distance / 1609.34).toFixed(2)} mi | ${formatDuration(r.moving_time)} | ${r.is_runna ? '✓' : ''} |`;
    }),
  ];

  return [
    '---',
    'tags: [running, strava, dashboard, auto-generated]',
    `updated: ${today}`,
    `total_runs_synced: ${records.length}`,
    '---',
    '',
    '# Running Dashboard',
    '',
    `*Auto-generated by strava-mcp-server. Hand-maintained context lives in [[Running]].*`,
    `*Last synced: ${today}. Total runs: ${records.length}.*`,
    '',
    ...trendLines,
    ...rollingLines,
    ...recentLines,
    '',
  ].join('\n');
}

// ---- Schema + sync entry ----
export const syncRunsInputSchema = {
  full_sync: z.boolean().default(false)
    .describe('If true, re-fetch all runs ignoring sync state. Defaults to incremental (only runs newer than last sync).'),
  overwrite_existing: z.boolean().default(false)
    .describe('If true, overwrite existing per-run .md notes. Use after a template format change.'),
  max_runs: z.number().int().min(1).max(500).optional()
    .describe('Cap the number of runs processed in this sync. Useful for smoke testing (e.g. max_runs: 3).'),
};

export async function syncRunsToObsidian(args: {
  full_sync: boolean;
  overwrite_existing: boolean;
  max_runs?: number;
}): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const log: string[] = [];
  const syncStartedAt = new Date().toISOString();
  const today = syncStartedAt.slice(0, 10);

  if (!OBSIDIAN_VAULT_PATH) {
    return {
      content: [{
        type: 'text',
        text: 'Error: OBSIDIAN_VAULT_PATH is not set. Add it to the MCP env (point to vault root).',
      }],
    };
  }

  // Validate vault path before any mkdirSync — typos like "Obsdian Vault" would
  // otherwise silently create a phantom directory tree the user never finds.
  try {
    const stat = fs.statSync(OBSIDIAN_VAULT_PATH);
    if (!stat.isDirectory()) {
      return { content: [{ type: 'text', text: `Error: OBSIDIAN_VAULT_PATH exists but is not a directory: ${OBSIDIAN_VAULT_PATH}` }] };
    }
  } catch {
    return { content: [{ type: 'text', text: `Error: OBSIDIAN_VAULT_PATH does not exist: ${OBSIDIAN_VAULT_PATH}. Check the path and that the vault is mounted.` }] };
  }

  const runsDir = path.join(OBSIDIAN_VAULT_PATH, SYNC_DIR_NAME);
  const syncStatePath = path.join(runsDir, SYNC_STATE_FILENAME);
  const manifestPath = path.join(runsDir, MANIFEST_FILENAME);
  const dashboardPath = path.join(OBSIDIAN_VAULT_PATH, DASHBOARD_NAME);

  try {
    if (!fs.existsSync(runsDir)) {
      fs.mkdirSync(runsDir, { recursive: true });
      log.push(`Created: ${runsDir}`);
    }

    const syncState = loadSyncState(syncStatePath);
    const manifest = loadManifest(manifestPath);
    const isFirstRun = syncState === null;
    const afterUnix = !args.full_sync && syncState?.last_synced_start_date
      ? Math.floor(new Date(syncState.last_synced_start_date).getTime() / 1000)
      : undefined;

    log.push(afterUnix
      ? `Incremental sync since ${new Date(afterUnix * 1000).toISOString()}`
      : 'Full sync from scratch');

    // Paginate through activities, filtering to runs.
    // Full sync (no afterUnix) intentionally goes deep — capping at 50 silently
    // truncates history. If the caller wants a smaller window they pass max_runs.
    const newRuns: StravaActivitySummary[] = [];
    const seenIds = new Set<number>();
    const defaultCap = afterUnix ? 200 : 2000;
    const maxRuns = args.max_runs ?? defaultCap;
    let page = 1;
    while (newRuns.length < maxRuns) {
      const params: { per_page: number; page: number; after?: number } = { per_page: 100, page };
      if (afterUnix) params.after = afterUnix;
      const batch = await listActivities(params);
      if (batch.length === 0) break;
      for (const a of batch) {
        if (!isRun(a)) continue;
        if (seenIds.has(a.id)) continue;
        seenIds.add(a.id);
        newRuns.push(a);
        if (newRuns.length >= maxRuns) break;
      }
      log.push(`Page ${page}: fetched ${batch.length} activities, ${newRuns.length} runs accumulated`);
      if (batch.length < 100) break;
      page++;
      if (page > 20) break;  // safety
    }

    log.push(`Processing ${newRuns.length} runs`);

    let written = 0, skipped = 0, errors = 0;
    const newRecords: SyncedRunRecord[] = [];

    for (const summary of newRuns) {
      const filename = runFilename(summary);
      const filePath = path.join(runsDir, filename);
      assertInside(filePath, runsDir);
      if (!args.overwrite_existing && fs.existsSync(filePath)) {
        skipped++;
        // Still record it for the manifest if we don't have it
        if (!manifest.some(m => m.id === summary.id)) {
          newRecords.push({
            id: summary.id,
            start_date: summary.start_date,
            start_date_local: summary.start_date_local ?? summary.start_date,
            name: summary.name,
            type: summary.type,
            distance: summary.distance,
            moving_time: summary.moving_time,
            average_heartrate: summary.average_heartrate ?? null,
            is_runna: wasRunnaWorkout(summary).is_runna,
            filename,
          });
        }
        continue;
      }

      try {
        const detail = await getActivity(summary.id, true);
        const note = formatRunNote(detail, today);
        fs.writeFileSync(filePath, note, 'utf-8');
        written++;
        newRecords.push({
          id: detail.id,
          start_date: detail.start_date,
          start_date_local: detail.start_date_local ?? detail.start_date,
          name: detail.name,
          type: detail.type,
          distance: detail.distance,
          moving_time: detail.moving_time,
          average_heartrate: detail.average_heartrate ?? null,
          is_runna: wasRunnaWorkout(detail).is_runna,
          filename,
        });
      } catch (e) {
        errors++;
        log.push(`  Error writing ${filename}: ${e instanceof Error ? e.message : e}`);
      }
    }

    // Merge with existing manifest; sort newest first so dashboard's "last 10" and
    // the sync-state cursor are both deterministic regardless of fetch order.
    const newIds = new Set(newRecords.map(r => r.id));
    const mergedManifest = [...newRecords, ...manifest.filter(r => !newIds.has(r.id))]
      .sort((a, b) => b.start_date.localeCompare(a.start_date));
    saveManifest(manifestPath, mergedManifest);

    // Dashboard — atomic so Obsidian never sees a half-written file.
    atomicWrite(dashboardPath, formatDashboard(mergedManifest, today));
    log.push(`Wrote dashboard with ${mergedManifest.length} total runs`);

    // Advance sync state to the most recent run we saw (manifest is sorted desc).
    const mostRecent = mergedManifest[0]?.start_date ?? syncState?.last_synced_start_date ?? null;
    saveSyncState(syncStatePath, {
      last_synced_start_date: mostRecent,
      last_sync_at: syncStartedAt,
      total_runs_synced: mergedManifest.length,
    });

    return {
      content: [{
        type: 'text',
        text: [
          `Sync complete (${args.full_sync || isFirstRun ? 'full' : 'incremental'}).`,
          `  Written: ${written}  Skipped: ${skipped}  Errors: ${errors}`,
          `  Manifest: ${mergedManifest.length} total runs`,
          `  Dashboard: ${dashboardPath.replace(OBSIDIAN_VAULT_PATH + path.sep, '')}`,
          '',
          'Log:',
          ...log,
        ].join('\n'),
      }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{
        type: 'text',
        text: `Sync failed: ${message}\n\nLog:\n${log.join('\n')}`,
      }],
    };
  }
}

// Exported for the CLI entry
export async function syncCli(): Promise<void> {
  const result = await syncRunsToObsidian({
    full_sync: false,
    overwrite_existing: false,
    max_runs: DEFAULT_SYNC_MAX_RUNS,
  });
  process.stdout.write(result.content[0].text + '\n');
}
