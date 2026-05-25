import * as http from 'http';
import * as url from 'url';
import * as crypto from 'crypto';
import axios from 'axios';
import open from 'open';
import * as dotenv from 'dotenv';
dotenv.config();

import {
  STRAVA_OAUTH_AUTHORIZE,
  STRAVA_OAUTH_TOKEN,
  STRAVA_OAUTH_PORT,
  STRAVA_OAUTH_REDIRECT,
  STRAVA_OAUTH_SCOPES,
} from '../constants';
import { saveTokens } from '../client';
import { StravaTokens } from '../types';

async function main(): Promise<void> {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    process.stderr.write(
      'Error: STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET must be set in .env or environment.\n' +
      'Create your app at https://www.strava.com/settings/api and set the Authorization Callback Domain to "localhost".\n'
    );
    process.exit(1);
  }

  // Random `state` defeats login-CSRF: anyone navigating the user's browser to
  // http://localhost:<port>/callback?code=... can't fake an expected state.
  const expectedState = crypto.randomBytes(16).toString('hex');

  const authorizeUrl =
    `${STRAVA_OAUTH_AUTHORIZE}?` +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: STRAVA_OAUTH_REDIRECT,
      response_type: 'code',
      approval_prompt: 'auto',
      scope: STRAVA_OAUTH_SCOPES,
      state: expectedState,
    }).toString();

  const codePromise = new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end('No URL');
        return;
      }
      const parsed = url.parse(req.url, true);
      if (parsed.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const noStoreHeaders = {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      };
      const code = parsed.query.code as string | undefined;
      const state = parsed.query.state as string | undefined;
      const error = parsed.query.error as string | undefined;
      if (error) {
        res.writeHead(400, noStoreHeaders);
        res.end(`Strava OAuth error: ${error}`);
        server.close();
        reject(new Error(`Strava OAuth error: ${error}`));
        return;
      }
      if (!code) {
        res.writeHead(400, noStoreHeaders);
        res.end('Missing code parameter');
        return;
      }
      if (state !== expectedState) {
        res.writeHead(400, noStoreHeaders);
        res.end('State parameter mismatch — rejecting callback. This is a CSRF protection.');
        server.close();
        reject(new Error('OAuth state mismatch — possible CSRF. Retry npm run oauth.'));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      });
      res.end(
        '<html><body style="font-family:sans-serif;padding:2em">' +
        '<h1>Strava authorized</h1>' +
        '<p>You can close this tab and return to the terminal.</p>' +
        '</body></html>'
      );
      server.close();
      resolve(code);
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        process.stderr.write(
          `Port ${STRAVA_OAUTH_PORT} is in use. Set STRAVA_OAUTH_PORT to a free port and retry.\n`
        );
      }
      reject(err);
    });
    server.listen(STRAVA_OAUTH_PORT, '127.0.0.1', () => {
      process.stderr.write(`Listening for OAuth callback at ${STRAVA_OAUTH_REDIRECT}\n`);
    });
  });

  process.stderr.write(`Opening browser to authorize Strava access...\n${authorizeUrl}\n`);
  try {
    await open(authorizeUrl);
  } catch {
    process.stderr.write(
      `Could not auto-open the browser. Visit this URL manually:\n${authorizeUrl}\n`
    );
  }

  const code = await codePromise;
  process.stderr.write('Authorization code received. Exchanging for tokens...\n');

  // Form-encoded body, not query params — keeps client_secret out of axios error URLs / logs.
  const tokenBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
  });
  const res = await axios.post(STRAVA_OAUTH_TOKEN, tokenBody, {
    timeout: 15_000,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const body = res.data as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    expires_in: number;
    athlete: { id: number };
    token_type: string;
  };

  const tokens: StravaTokens = {
    client_id: clientId,
    client_secret: clientSecret,
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: body.expires_at,
    athlete_id: body.athlete?.id,
    scope: STRAVA_OAUTH_SCOPES,
  };

  saveTokens(tokens);
  process.stderr.write(
    `Tokens written successfully (athlete ID: ${tokens.athlete_id}).\n` +
    `Expires at: ${new Date(tokens.expires_at * 1000).toISOString()}\n`
  );
  process.exit(0);
}

main().catch(err => {
  process.stderr.write(`Bootstrap failed: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
