# 🏃 strava-mcp-server

**Runna workout parsing + Obsidian sync for Strava. Complements the native Strava MCP with the coaching detail it doesn't expose.**

![MCP](https://img.shields.io/badge/protocol-MCP-6E56CF?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Node 22+](https://img.shields.io/badge/Node-22%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)

A small [MCP](https://modelcontextprotocol.io) server that adds the Runna coaching layer and Obsidian sync on top of Strava. Ask "how's my mileage trending?" or "break down last Tuesday's intervals" and your AI actually knows.

Strava now ships an [official MCP](https://developers.strava.com) that covers general activity browsing, gear, clubs, segments, and athlete profiles. **This server is the complement layer** — it handles the things the native MCP doesn't: detecting [Runna](https://www.runna.com/)-coached workouts (Strava acquired Runna in 2025; activities carry a `device_name: Runna` marker), parsing interval metadata from lap data, computing trend analytics, and syncing per-run notes to Obsidian. Run both together for full coverage.

## Tools exposed

All five tools are specific to what the native Strava MCP doesn't cover. For general Strava queries (all activity types, gear, clubs, segments, athlete profile, zones), use the native MCP tools directly.

| Tool | What it adds over the native MCP |
|---|---|
| `list_recent_runs` | Run-filtered activity list with `is_runna` flag on each result |
| `get_run` | Runna workout parsing: interval count, work/rest distance, target pace, lap pattern; also HR/pace zone distribution |
| `get_athlete_stats` | Lifetime, YTD, and 4-week running totals — `/athletes/{id}/stats` endpoint not exposed by native MCP |
| `analyze_recent_trends` | Weekly mileage, pace trend, HR-based easy/hard split, Runna workout count over N weeks |
| `sync_runs_to_obsidian` | Incremental sync of per-run markdown notes + rolling-stats dashboard to an Obsidian vault |

## Using alongside the native Strava MCP

If you have access to Strava's official MCP (available in Claude Desktop / Cowork via the Strava integration), run both servers simultaneously. They authenticate to the same Strava account independently.

**Routing guide:**

| Question | Use |
|---|---|
| "List my recent activities" / non-run sports | Native `list_activities` |
| "Show my best efforts / segments on that run" | Native `get_activity_performance` |
| "Show me the GPS trace / HR drift stream" | Native `get_activity_streams` |
| "What gear am I using?" / clubs / training plans | Native `get_gear`, `get_club_info`, `get_training_plan` |
| "Was that a Runna workout? Break down the intervals" | This server: `get_run` |
| "How many Runna sessions this month?" | This server: `analyze_recent_trends` |
| "What's my YTD mileage?" | This server: `get_athlete_stats` |
| "Sync my runs to Obsidian" | This server: `sync_runs_to_obsidian` |

Claude will see both servers' tool descriptions and can call either or both within a single response.

## Setup

### 1. Create a Strava API app

Go to https://www.strava.com/settings/api → **Create & Manage Your App**:
- **Authorization Callback Domain:** `localhost`
- Application Name / Website / Description: anything
- After creating, copy the **Client ID** (6-digit) and **Client Secret** (40-char hex)

### 2. Install + configure

```bash
git clone https://github.com/<your-username>/strava-mcp-server.git
cd strava-mcp-server
cp .env.example .env
# Edit .env and paste in your Client ID + Client Secret
npm install
npm run build
```

### 3. One-time OAuth

```bash
npm run oauth
```

This opens your browser to Strava's authorize page. Click **Authorize**; the script catches the redirect, writes tokens to `~/.config/strava-mcp/tokens.json` (mode 0600), and exits. Tokens auto-refresh on every API call (Strava rotates the refresh token; the file is rewritten atomically).

### 4. Register with Claude

Add a block to your client's MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json` for Claude Desktop / Cowork; `~/.claude/settings.json` for Claude Code):

```json
{
  "mcpServers": {
    "strava": {
      "command": "node",
      "args": ["/absolute/path/to/strava-mcp-server/dist/index.js"],
      "env": {
        "STRAVA_TOKENS_PATH": "/Users/YOUR-USER/.config/strava-mcp/tokens.json",
        "OBSIDIAN_VAULT_PATH": "/Users/YOUR-USER/Documents/Obsidian Vault"
      }
    }
  }
}
```

Client ID + Secret are read from the tokens file (written by `npm run oauth`), so they don't need to be in the MCP env block.

Quit + relaunch your Claude client. The tools should appear in a chat.

## Optional: daily auto-sync via launchd (macOS)

A sample plist is at `launchd/com.example.strava-sync.plist.template`. To install:

1. Copy it to `~/Library/LaunchAgents/`, renaming as you wish (e.g. `com.<you>.strava-sync.plist`).
2. Edit the file and replace every `__USERNAME__` with your macOS short username.
3. `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<your-label>.plist`

Daily runs hit Strava's incremental window — typically pulls 0–3 new runs. Logs go to `~/Library/Logs/strava-sync.log`.

To kickstart a run on demand: `launchctl kickstart -k gui/$(id -u)/<your-label>`.

## Obsidian sync layout

Sync writes to (paths relative to your vault root):
- `Lifestyle/Runs/{YYYY-MM-DD}-{slug}.md` — one file per run, Dataview-friendly frontmatter (date, distance_mi, duration, avg_pace, avg_hr, runna_workout, strava_id) plus summary, lap table, Runna metadata, and a link back to Strava.
- `Lifestyle/Running-Dashboard.md` — auto-generated, overwritten each sync. Rolling 7/30/90-day stats and a last-10-runs table.
- `Lifestyle/Runs/.strava-sync-state.json` — incremental cursor.
- `Lifestyle/Runs/.strava-manifest.json` — full index, used to rebuild the dashboard.

Any pre-existing file at `Lifestyle/Running.md` is **never** touched by the sync — keep it for hand-maintained narrative.

If you don't use Obsidian (or you want to put runs somewhere else), set `OBSIDIAN_VAULT_PATH` to any directory you want, or leave it unset and use the non-sync tools only.

## Architecture notes

- TypeScript, CommonJS, Node 22+
- HTTP via `axios` with in-memory cache, throttle, and 429/5xx retry
- Strava tokens auto-refresh when within 60s of expiry; refresh token is rotated and persisted atomically (`writeFileSync(tmp) + renameSync`)
- Rate-limit headers parsed on every response; sync sleeps proactively when 15-min usage > 90 of 100
- One file per tool group under `src/tools/`; pattern mirrors the [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) `McpServer.registerTool` shape

## Limitations

- **No upcoming workouts.** Strava acquired Runna in 2025 but as of writing there's no combined API for upcoming/planned workouts or in-app coaching feedback. We only see what's already in Strava.
- **Single user.** OAuth flow assumes one athlete. Multi-user would need a token store keyed by athlete_id and an HTTP auth handshake.
- **Cron is launchd-only** (macOS). Linux/Windows users would need to add their own scheduler around `npm run sync`.

## Troubleshooting

**`Strava tokens file not found at /Users/.../tokens.json`** — Run `npm run oauth` to bootstrap. If you already did, check that `STRAVA_TOKENS_PATH` in the MCP env block matches where the bootstrap wrote them.

**Tools don't appear in Claude after editing the config** — Quit and relaunch your Claude client. The MCP block is only read on startup.

**`Port 42424 is in use`** — Set `STRAVA_OAUTH_PORT=12345` (or any free port) in `.env` and re-run `npm run oauth`. Strava's Authorization Callback Domain is just `localhost`, so any port works.

**Sync shows zero runs** — Check that your activities are `type: Run` (not `Ride`, `Walk`, etc.). The sync filters to `Run`, `TrailRun`, `VirtualRun` by design. If you want a different filter, edit `RUN_TYPES` in `src/tools/obsidian.ts`.

**Runna detection misses my workouts** — Detection checks (in order) `device_name === "Runna"`, a `Runna:` name prefix, and description markers. Your Strava data may not include `device_name` if Runna uploaded as a generic GPX. Check `get_run` output for the `runna` field — if `is_runna: false` but it really was a Runna workout, please open an issue with the activity name/description.

**Token refresh fails after weeks of inactivity** — Strava refresh tokens are durable but the app authorization can be revoked. Re-run `npm run oauth`.

## License

MIT — see [LICENSE](LICENSE).
