# Contributing

This is a personal-use repo, but PRs are welcome if you find a bug or have a useful improvement.

## Before opening a PR

1. **Open an issue first** if the change is bigger than a few lines — saves both of us time.
2. `npm install && npm test && npm run typecheck` must all pass.
3. Keep the diff focused — one logical change per PR.
4. Don't add dependencies unless they're load-bearing.

## Security

Do **not** open an issue for a security vulnerability. Email me directly (see GitHub profile).

In particular, do not paste real Strava tokens, client IDs, or client secrets into issues or PRs. The OAuth bootstrap script will rotate them anyway, but redact regardless.
