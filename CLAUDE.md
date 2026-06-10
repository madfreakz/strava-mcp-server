# Working notes for AI assistants

Operational context for Claude/Cursor/etc. when modifying this repo.

## Native Strava MCP coexistence

This server (`strava-runna-obsidian`) runs **alongside** the native Strava MCP (UUID `8dea3e80-*`). Both are auth'd to the same athlete (58681246). They are complementary, not alternatives — when answering a Strava question, consider both.

| Layer | Server | Use for |
|---|---|---|
| Native (broader surface) | `mcp__8dea3e80-*` | list_activities, get_activity_performance, get_activity_streams, get_athlete_profile, get_athlete_zones, get_gear, get_training_plan, get_club_info — general Strava queries |
| This server (value layer) | `strava-runna-obsidian` | Runna workout detection, analyze_recent_trends, get_athlete_stats (lifetime/YTD), sync_runs_to_obsidian + daily cron |

**Do not remove tools from this server without checking whether `src/cli/sync.ts` depends on them** — the launchd cron calls the tool functions in `src/tools/` directly (not via MCP), so removing an MCP tool registration is safe, but deleting the underlying function breaks the cron.

## Known pitfalls

- **Strava refresh tokens rotate on every refresh.** The tokens file must be written atomically — always `writeFileSync(tmp) + renameSync(tmp, real)`. Never leave the refresh_token stale. See `src/client.ts:saveTokens`.
- **Access tokens expire after 6 hours.** `src/client.ts:ensureFreshToken` refreshes when `expires_at - 60s < now`.
- **Strava acquired Runna in 2025.** Runna-uploaded activities carry `device_name === "Runna"`. They do **not** carry a `Runna:` name prefix in our test data. Detection in `src/tools/runna.ts` checks `device_name` first, then name prefix, then description markers — keep all three. Don't simplify to one signal.
- **Activity dates: prefer `start_date_local`.** The dashboard, frontmatter, and filenames all use the local date. UTC date can shift the apparent day for evening runs.
- **Rate limits are load-bearing.** Strava allows 100 reads/15 min, 1000/day. 700 ms min interval between requests. Sleep on 429. The full sync of a year of runs is ~150 detail calls.
- **Manifest is the source of truth for the dashboard.** Per-run notes are derived. Re-render the dashboard by running sync with no new runs — the manifest is reloaded from disk.

## Don't touch

- A file at `{vault}/Lifestyle/Running.md` (if it exists) is hand-maintained by the user — narrative, race calendar, route notes. The sync writes to `Lifestyle/Runs/` and `Lifestyle/Running-Dashboard.md` instead.

## Build, test, run

```bash
npm install
npm run build         # tsc --noCheck → dist/
npm test              # vitest (Runna detection, sync-state, downsampling — no network)
npm run oauth         # one-time browser auth flow
npm run sync          # standalone sync CLI (what the launchd cron runs)
node dist/index.js    # run the MCP server directly on stdio
```

## File map

```
src/
├── index.ts              # MCP bootstrap + tool registration
├── client.ts             # HTTP wrapper, OAuth refresh, cache, throttle, rate-limit tracking
├── constants.ts          # env vars, URLs, TTLs, thresholds
├── types.ts              # Strava response shapes + internal types
├── auth/
│   └── oauth-bootstrap.ts  # npm run oauth — one-time browser flow
├── cli/
│   └── sync.ts             # npm run sync — what launchd invokes
└── tools/
    ├── activities.ts     # list_recent_runs, get_run (both Runna-augmented)
    ├── athlete.ts        # get_athlete_stats (lifetime/YTD — no native equivalent); get_athlete_profile unused by MCP but kept for internal use
    ├── streams.ts        # get_run_streams — NOT registered as MCP tool (native get_activity_streams covers it); used internally by obsidian sync
    ├── runna.ts          # was_runna_workout — pure, no I/O
    ├── trends.ts         # analyze_recent_trends
    └── obsidian.ts       # sync_runs_to_obsidian + dashboard formatter
```

## Environment

Env vars (loaded via dotenv from `.env`, also overridable via MCP `env:` block):
- `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` — only needed for `npm run oauth`; the runtime reads them back from the tokens file
- `STRAVA_TOKENS_PATH` — default `~/.config/strava-mcp/tokens.json`
- `OBSIDIAN_VAULT_PATH` — vault root; if unset, sync tool is disabled
- `STRAVA_OAUTH_PORT` — default 42424
