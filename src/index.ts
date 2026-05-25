import * as dotenv from 'dotenv';
dotenv.config();

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { listRecentRunsInputSchema, listRecentRuns, getRunInputSchema, getRun } from './tools/activities';
import { getAthleteProfileInputSchema, getAthleteProfile, getAthleteStatsInputSchema, getAthleteStatsTool } from './tools/athlete';
import { getRunStreamsInputSchema, getRunStreams } from './tools/streams';
import { analyzeRecentTrendsInputSchema, analyzeRecentTrends } from './tools/trends';
import { syncRunsInputSchema, syncRunsToObsidian } from './tools/obsidian';

const server = new McpServer({
  name: 'strava-mcp-server',
  version: '1.0.0',
});

server.registerTool(
  'list_recent_runs',
  {
    title: 'List Recent Runs',
    description:
      'Fetch the most recent run activities from Strava. Filtered to type=Run, TrailRun, VirtualRun. ' +
      'Returns id, name, date, distance (m + mi), moving time, pace, HR, elevation, and a runna flag. ' +
      'Use per_page (max 200), page, and ISO datetime after/before for windowing. ' +
      'Use the returned activity_id with get_run or get_run_streams for more detail.',
    inputSchema: listRecentRunsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  listRecentRuns
);

server.registerTool(
  'get_run',
  {
    title: 'Get Run Detail',
    description:
      'Fetch full detail for a single run including laps and HR/pace zone distribution. ' +
      'Augments the response with Runna detection: if the activity came from a Runna coached workout, ' +
      'returns parsed workout title, interval count, work distance, target pace, and lap pattern. ' +
      'Requires an activity_id from list_recent_runs. ' +
      'Prefer this over get_run_streams for any lap-level or summary question — get_run_streams is ' +
      'only needed when you need second-by-second time-series data (e.g. HR drift, mid-run pacing).',
    inputSchema: getRunInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  getRun
);

server.registerTool(
  'get_run_streams',
  {
    title: 'Get Run Streams',
    description:
      'Fetch time-series streams (HR, pace, distance, altitude, cadence, GPS) for a single run, ' +
      'downsampled to at most max_points (default 1000) by uniform stride. ' +
      'Use ONLY when you need second-by-second data (HR drift over a tempo, GPS path, cadence trend ' +
      'within a single run). For lap-level or summary questions use get_run, which is much cheaper.',
    inputSchema: getRunStreamsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  getRunStreams
);

server.registerTool(
  'get_athlete_profile',
  {
    title: 'Get Athlete Profile',
    description:
      "Fetch the authorized athlete's Strava profile (name, location, weight, FTP, measurement preference) " +
      'and configured HR/power zones.',
    inputSchema: getAthleteProfileInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  getAthleteProfile
);

server.registerTool(
  'get_athlete_stats',
  {
    title: 'Get Athlete Stats',
    description:
      'Fetch lifetime, YTD, and recent (4-week) running totals — count, distance, moving time, elevation. ' +
      'Also includes cycling totals if present.',
    inputSchema: getAthleteStatsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  getAthleteStatsTool
);

server.registerTool(
  'analyze_recent_trends',
  {
    title: 'Analyze Recent Running Trends',
    description:
      'Compute weekly mileage, pace trend (first half vs second half of window), HR-based easy/hard split, ' +
      'longest run, and Runna workout count over the last N weeks (1-52, default 8). ' +
      'Optionally pass est_max_hr for sharper easy/hard classification (defaults to 190).',
    inputSchema: analyzeRecentTrendsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  analyzeRecentTrends
);

server.registerTool(
  'sync_runs_to_obsidian',
  {
    title: 'Sync Runs to Obsidian',
    description:
      'Export run activities to Obsidian as individual markdown notes under {vault}/Lifestyle/Runs/. ' +
      'Each note has frontmatter (date, distance, pace, HR, runna_workout, strava_id) for Dataview, ' +
      'plus a summary, lap table, and (if applicable) parsed Runna workout metadata. ' +
      'Also writes {vault}/Lifestyle/Running-Dashboard.md with rolling 7/30/90-day stats. ' +
      'By default runs incrementally — only new runs since last sync. ' +
      'Set full_sync=true to re-process from scratch. ' +
      'Use max_runs=3 for a smoke test before a full sync.',
    inputSchema: syncRunsInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  syncRunsToObsidian
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('Strava MCP server running on stdio\n');
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
