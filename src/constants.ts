import * as dotenv from 'dotenv';
dotenv.config();

import * as path from 'path';
import * as os from 'os';

export const STRAVA_API_BASE = 'https://www.strava.com/api/v3';
export const STRAVA_OAUTH_AUTHORIZE = 'https://www.strava.com/oauth/authorize';
export const STRAVA_OAUTH_TOKEN = 'https://www.strava.com/api/v3/oauth/token';

export const OBSIDIAN_VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH ?? '';

export const STRAVA_TOKENS_PATH =
  process.env.STRAVA_TOKENS_PATH ??
  path.join(os.homedir(), '.config', 'strava-mcp', 'tokens.json');

export const STRAVA_OAUTH_PORT = Number(process.env.STRAVA_OAUTH_PORT ?? 42424);
export const STRAVA_OAUTH_REDIRECT = `http://localhost:${STRAVA_OAUTH_PORT}/callback`;
export const STRAVA_OAUTH_SCOPES = 'read,activity:read_all,profile:read_all';

// Rate limiting
export const MIN_REQUEST_INTERVAL_MS = 700;
export const RETRY_AFTER_429_MS = 15 * 60 * 1000;
export const RETRY_AFTER_5XX_MS = 2_000;
export const RATE_LIMIT_SHORT_THRESHOLD = 90;   // sleep when 15min usage > this
export const RATE_LIMIT_DAILY_THRESHOLD = 950;  // sleep when daily usage > this

// Cache TTLs
export const CACHE_TTL_ACTIVITIES_LIST_MS = 5 * 60 * 1000;
export const CACHE_TTL_ACTIVITY_DETAIL_MS = 24 * 60 * 60 * 1000;
export const CACHE_TTL_STREAMS_MS = 24 * 60 * 60 * 1000;
export const CACHE_TTL_ATHLETE_MS = 60 * 60 * 1000;
export const CACHE_TTL_STATS_MS = 60 * 60 * 1000;

// Pagination
export const DEFAULT_PER_PAGE = 30;
export const MAX_PER_PAGE = 200;

// Sync defaults
export const SYNC_DIR_NAME = path.join('Lifestyle', 'Runs');
export const DASHBOARD_NAME = path.join('Lifestyle', 'Running-Dashboard.md');
export const SYNC_STATE_FILENAME = '.strava-sync-state.json';
export const MANIFEST_FILENAME = '.strava-manifest.json';
export const DEFAULT_SYNC_MAX_RUNS = 50;
export const STREAM_MAX_POINTS = 1000;

export const USER_AGENT = 'strava-mcp-server/1.0 (Mark Fok)';
