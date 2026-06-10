import * as dotenv from 'dotenv';
dotenv.config();

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { listRecentRunsInputSchema, listRecentRuns, getRunInputSchema, getRun } from './tools/activities';
import { getAthleteStatsInputSchema, getAthleteStatsTool } from './tools/athlete';
import { analyzeRecentTrendsInputSchema, analyzeRecentTrends } from './tools/trends';
import { syncRunsInputSchema, syncRunsToObsidian } from './tools/obsidian';

// This server is the Runna + Obsidian layer that SUPPLEMENTS the native Strava MCP.
// Native Strava MCP (mcp__8dea3e80-*): list_activities, get_activity_performance,
//   get_activity_streams, get_athlete_profile, get_athlete_zones, get_gear,
//   get_training_plan, get_club_info — use for general Strava queries.
// This server: Runna detection, custom trend analytics, Obsidian sync + dashboard.
// When answering a Strava question, consider whether one or both servers are needed.
const server = new McpServer({
  name: 'strava-runna-obsidian',
  version: '1.0.0',
});

server.registerTool(
  'list_recent_runs',
  {
    title: 'List Recent Runs',
    description:
      'RUNNA LAYER — supplements the native Strava MCP. ' +
      'Use native list_activities for general activity browsing (all sport types, no Runna flag). ' +
      'Use THIS tool when you need the is_runna flag on each result — detects Runna-coached workouts ' +
      'via device_name (Strava-acquired Runna app). Filtered to Run/TrailRun/VirtualRun. ' +
      'Returns id, name, date, distance (m + mi), moving time, pace, HR, elevation, is_runna. ' +
      'Use per_page (max 200), page, and ISO datetime after/before for windowing.',
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
      'RUNNA LAYER — supplements the native Strava MCP. ' +
      'Use native get_activity_performance for general run detail (best_efforts, segment_efforts, laps, perceived exertion). ' +
      'Use THIS tool when you need Runna workout parsing: interval count, work/rest distance, target pace, lap pattern. ' +
      'Also includes HR/pace zone distribution for the activity. ' +
      'Requires an activity_id (from list_recent_runs or native list_activities). ' +
      'For raw time-series streams (HR drift, GPS path, cadence), use native get_activity_streams.',
    inputSchema: getRunInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  getRun
);


server.registerTool(
  'get_athlete_stats',
  {
    title: 'Get Athlete Stats',
    description:
      'NO NATIVE EQUIVALENT — the native Strava MCP does not expose lifetime/YTD totals. ' +
      'Fetches lifetime, YTD, and recent (4-week) running totals — count, distance, moving time, elevation. ' +
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
      'NO NATIVE EQUIVALENT — custom analytics layer. ' +
      'Computes weekly mileage, pace trend (first half vs second half of window), HR-based easy/hard split, ' +
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
      'NO NATIVE EQUIVALENT — the native Strava MCP has no Obsidian integration. ' +
      'Exports run activities to Obsidian as individual markdown notes under {vault}/Lifestyle/Runs/. ' +
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
