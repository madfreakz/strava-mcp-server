import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as dotenv from 'dotenv';
dotenv.config();

import {
  STRAVA_API_BASE,
  STRAVA_OAUTH_TOKEN,
  STRAVA_TOKENS_PATH,
  USER_AGENT,
  MIN_REQUEST_INTERVAL_MS,
  RETRY_AFTER_429_MS,
  RETRY_AFTER_5XX_MS,
  RATE_LIMIT_SHORT_THRESHOLD,
  RATE_LIMIT_DAILY_THRESHOLD,
  CACHE_TTL_ACTIVITIES_LIST_MS,
  CACHE_TTL_ACTIVITY_DETAIL_MS,
  CACHE_TTL_STREAMS_MS,
  CACHE_TTL_ATHLETE_MS,
  CACHE_TTL_STATS_MS,
} from './constants';

import {
  StravaTokens,
  StravaActivitySummary,
  StravaActivityDetail,
  StravaAthlete,
  StravaAthleteStats,
  StravaStreamSet,
  StravaActivityZones,
} from './types';

// ---- In-memory cache ----
interface CacheEntry<T> { data: T; expiresAt: number; }
const cache = new Map<string, CacheEntry<unknown>>();

async function getCached<T>(key: string, fetcher: () => Promise<T>, ttlMs: number): Promise<T> {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.data as T;
  const data = await fetcher();
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

// ---- Throttle ----
let lastRequestAt = 0;
async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

// ---- Tokens (lazy load + atomic write) ----
let tokens: StravaTokens | null = null;

function ensureClientCreds(t: Partial<StravaTokens>): StravaTokens {
  const client_id = t.client_id || process.env.STRAVA_CLIENT_ID;
  const client_secret = t.client_secret || process.env.STRAVA_CLIENT_SECRET;
  if (!client_id || !client_secret) {
    throw new Error(
      'Missing Strava client credentials. Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in env, ' +
      'or include them in the tokens file. Create an app at https://www.strava.com/settings/api'
    );
  }
  return { ...(t as StravaTokens), client_id, client_secret };
}

export function loadTokens(): StravaTokens {
  if (tokens) return tokens;
  if (!fs.existsSync(STRAVA_TOKENS_PATH)) {
    throw new Error(
      `Strava tokens file not found at ${STRAVA_TOKENS_PATH}. ` +
      `Run 'npm run oauth' to authorize.`
    );
  }
  try {
    const raw = JSON.parse(fs.readFileSync(STRAVA_TOKENS_PATH, 'utf-8')) as Partial<StravaTokens>;
    tokens = ensureClientCreds(raw);
    return tokens;
  } catch (e) {
    throw new Error(
      `Failed to parse Strava tokens at ${STRAVA_TOKENS_PATH}: ${e instanceof Error ? e.message : e}. ` +
      `Delete the file and re-run 'npm run oauth'.`
    );
  }
}

export function saveTokens(t: StravaTokens): void {
  const dir = path.dirname(STRAVA_TOKENS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  // Unique tmp name (pid + hrtime) to survive concurrent writes from the same process
  const tmp = `${STRAVA_TOKENS_PATH}.${process.pid}.${process.hrtime.bigint().toString(36)}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(t, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, STRAVA_TOKENS_PATH);
    try { fs.chmodSync(STRAVA_TOKENS_PATH, 0o600); } catch { /* best effort */ }
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
  tokens = t;
}

// Refresh-in-flight memoization — Strava rotates refresh_token on every call,
// so concurrent refreshes must coalesce or the loser's token is permanently dead.
let inflightRefresh: Promise<StravaTokens> | null = null;

async function refreshTokens(): Promise<StravaTokens> {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = (async (): Promise<StravaTokens> => {
    const current = loadTokens();
    // POST body form-encoded — never put client_secret in the query string,
    // because axios error logs include the request URL.
    const body = new URLSearchParams({
      client_id: current.client_id,
      client_secret: current.client_secret,
      grant_type: 'refresh_token',
      refresh_token: current.refresh_token,
    });
    const res = await axios.post(STRAVA_OAUTH_TOKEN, body, {
      timeout: 15_000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const data = res.data as {
      access_token: string;
      refresh_token: string;
      expires_at: number;
      expires_in: number;
      token_type: string;
    };
    const next: StravaTokens = {
      ...current,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
    };
    saveTokens(next);
    return next;
  })().finally(() => { inflightRefresh = null; });
  return inflightRefresh;
}

async function ensureFreshToken(): Promise<string> {
  const t = loadTokens();
  const now = Math.floor(Date.now() / 1000);
  if (t.expires_at - 60 <= now) {
    const refreshed = await refreshTokens();
    return refreshed.access_token;
  }
  return t.access_token;
}

// ---- Rate limit tracking ----
interface RateLimitState {
  shortUsage: number;
  dailyUsage: number;
  shortLimit: number;
  dailyLimit: number;
  lastUpdatedAt: number;
}
const rateLimit: RateLimitState = {
  shortUsage: 0, dailyUsage: 0, shortLimit: 100, dailyLimit: 1000, lastUpdatedAt: 0,
};

function parseRateLimitHeaders(res: AxiosResponse): void {
  const usage = String(res.headers['x-ratelimit-usage'] ?? '');
  const limit = String(res.headers['x-ratelimit-limit'] ?? '');
  if (usage) {
    const [s, d] = usage.split(',').map(n => Number(n.trim()));
    if (!Number.isNaN(s)) rateLimit.shortUsage = s;
    if (!Number.isNaN(d)) rateLimit.dailyUsage = d;
  }
  if (limit) {
    const [s, d] = limit.split(',').map(n => Number(n.trim()));
    if (!Number.isNaN(s)) rateLimit.shortLimit = s;
    if (!Number.isNaN(d)) rateLimit.dailyLimit = d;
  }
  rateLimit.lastUpdatedAt = Date.now();
}

async function preflightRateLimit(): Promise<void> {
  if (rateLimit.shortUsage > RATE_LIMIT_SHORT_THRESHOLD) {
    // Strava's 15-min windows are aligned to UTC quarter-hours.
    const now = new Date();
    const next = new Date(now);
    next.setUTCMinutes(Math.floor(now.getUTCMinutes() / 15) * 15 + 15, 0, 0);
    const waitMs = next.getTime() - now.getTime();
    await new Promise(r => setTimeout(r, Math.max(1000, waitMs)));
    rateLimit.shortUsage = 0;
  }
  if (rateLimit.dailyUsage > RATE_LIMIT_DAILY_THRESHOLD) {
    throw new Error(
      `Strava daily rate limit threshold reached (${rateLimit.dailyUsage}/${rateLimit.dailyLimit}). ` +
      `Retry after midnight UTC.`
    );
  }
}

// ---- HTTP wrapper ----
const http = axios.create({
  baseURL: STRAVA_API_BASE,
  timeout: 20_000,
  headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
});

interface RequestRetryState {
  /** True once we've forced a token refresh for this request (max once). */
  authRetried?: boolean;
  /** Number of 5xx retries so far. */
  serverRetries?: number;
  /** Number of 429 retries so far. */
  rateRetries?: number;
}

const MAX_SERVER_RETRIES = 3;
const MAX_RATE_RETRIES = 2;

async function request<T>(config: AxiosRequestConfig, retry: RequestRetryState = {}): Promise<T> {
  await throttle();
  await preflightRateLimit();
  const token = await ensureFreshToken();
  try {
    const res = await http.request<T>({
      ...config,
      headers: { ...(config.headers ?? {}), Authorization: `Bearer ${token}` },
    });
    parseRateLimitHeaders(res);
    return res.data;
  } catch (err) {
    const e = err as AxiosError;
    if (e.response) parseRateLimitHeaders(e.response);
    const status = e.response?.status;

    if (status === 401 && !retry.authRetried) {
      await refreshTokens();
      return request<T>(config, { ...retry, authRetried: true });
    }
    if (status === 429 && (retry.rateRetries ?? 0) < MAX_RATE_RETRIES) {
      const headerVal = Number(e.response?.headers['retry-after']);
      const retryAfter = Number.isFinite(headerVal) && headerVal > 0
        ? Math.max(1000, headerVal * 1000)
        : RETRY_AFTER_429_MS;
      await new Promise(r => setTimeout(r, retryAfter));
      return request<T>(config, { ...retry, rateRetries: (retry.rateRetries ?? 0) + 1 });
    }
    if (status && status >= 500 && (retry.serverRetries ?? 0) < MAX_SERVER_RETRIES) {
      // Exponential backoff: 2s, 4s, 8s
      const backoff = RETRY_AFTER_5XX_MS * Math.pow(2, retry.serverRetries ?? 0);
      await new Promise(r => setTimeout(r, backoff));
      return request<T>(config, { ...retry, serverRetries: (retry.serverRetries ?? 0) + 1 });
    }
    throw err;
  }
}

// ---- API methods ----
export interface ListActivitiesParams {
  per_page?: number;
  page?: number;
  after?: number;   // unix seconds
  before?: number;  // unix seconds
}

export async function listActivities(params: ListActivitiesParams = {}): Promise<StravaActivitySummary[]> {
  // Stable cache key independent of property order
  const cacheKey = `activities:${params.page ?? ''}:${params.per_page ?? ''}:${params.after ?? ''}:${params.before ?? ''}`;
  return getCached(
    cacheKey,
    () => request<StravaActivitySummary[]>({ method: 'GET', url: '/athlete/activities', params }),
    CACHE_TTL_ACTIVITIES_LIST_MS
  );
}

export async function getActivity(id: number, includeAllEfforts = true): Promise<StravaActivityDetail> {
  return getCached(
    `activity:${id}:${includeAllEfforts}`,
    () => request<StravaActivityDetail>({
      method: 'GET',
      url: `/activities/${id}`,
      params: { include_all_efforts: includeAllEfforts },
    }),
    CACHE_TTL_ACTIVITY_DETAIL_MS
  );
}

export async function getActivityStreams(
  id: number,
  keys: string[] = ['time', 'heartrate', 'velocity_smooth', 'distance', 'altitude', 'cadence', 'latlng']
): Promise<StravaStreamSet> {
  const keyParam = keys.join(',');
  return getCached(
    `streams:${id}:${keyParam}`,
    () => request<StravaStreamSet>({
      method: 'GET',
      url: `/activities/${id}/streams`,
      params: { keys: keyParam, key_by_type: true },
    }),
    CACHE_TTL_STREAMS_MS
  );
}

export async function getActivityZones(id: number): Promise<StravaActivityZones[]> {
  return getCached(
    `zones:${id}`,
    () => request<StravaActivityZones[]>({ method: 'GET', url: `/activities/${id}/zones` }),
    CACHE_TTL_ACTIVITY_DETAIL_MS
  );
}

export async function getAthlete(): Promise<StravaAthlete> {
  return getCached(
    'athlete',
    () => request<StravaAthlete>({ method: 'GET', url: '/athlete' }),
    CACHE_TTL_ATHLETE_MS
  );
}

export async function getAthleteZones(): Promise<unknown> {
  return getCached(
    'athlete:zones',
    () => request<unknown>({ method: 'GET', url: '/athlete/zones' }),
    CACHE_TTL_ATHLETE_MS
  );
}

export async function getAthleteStats(athleteId?: number): Promise<StravaAthleteStats> {
  let id = athleteId;
  if (!id) {
    const t = loadTokens();
    id = t.athlete_id;
    if (!id) {
      const a = await getAthlete();
      id = a.id;
    }
  }
  return getCached(
    `athlete:stats:${id}`,
    () => request<StravaAthleteStats>({ method: 'GET', url: `/athletes/${id}/stats` }),
    CACHE_TTL_STATS_MS
  );
}

export function clearCache(): void {
  cache.clear();
  tokens = null;
}

export function getRateLimitState(): RateLimitState {
  return { ...rateLimit };
}

// Re-export for OAuth bootstrap
export { os, fs, path };
