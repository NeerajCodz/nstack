# Linear connection service

The Next.js consent UI is an independent package in `apps/web`; the Convex project and its functions live at the repository root in `convex/`. The root manifest exists only to pin Convex and expose root-project CLI commands; the web app has its own dependencies, lockfile, and scripts.

## Install and configure

1. Install the two isolated packages:

   ```sh
   bun install
   bun install --cwd apps/web
   ```

2. Create a Linear OAuth application in Linear's API/OAuth settings. Set its callback URL to the exact Convex HTTP endpoint for the deployment, ending in `/linear/oauth/callback`. For a local development deployment, use the `.convex.site` URL printed by Convex; use the corresponding production deployment URL for production. Enable the scopes `read`, `write`, and `issues:create`.

3. Start/configure the root Convex project. Set these values as Convex deployment environment variables using the deployment dashboard or `bunx convex env set NAME VALUE` once per variable; do not commit them or expose them to the browser:

   - `LINEAR_OAUTH_CLIENT_ID` and `LINEAR_OAUTH_CLIENT_SECRET`: credentials for the Linear OAuth application.
   - `LINEAR_OAUTH_REDIRECT_URI`: the exact callback URL registered in Linear, ending in `/linear/oauth/callback`.
   - `LINEAR_TOKEN_ENCRYPTION_KEY`: base64 encoding of exactly 32 cryptographically random bytes. Generate it with a trusted local secret generator such as `bun -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.
   - `LINEAR_CONNECT_URL`: public origin of the Next.js site, without a path.

   Repeat this environment setup for every Convex deployment. For local development, run `bun run --bun convex:dev` from the repository root.

4. Copy `apps/web/.env.example` to `apps/web/.env.local` and set `NEXT_PUBLIC_CONVEX_URL` to the matching deployment's `.convex.cloud` URL and `NEXT_PUBLIC_SITE_URL` to the Next.js site's public origin. These are public web settings. Start the UI with `bun run --cwd apps/web --bun dev`.

5. Configure the nstack CLI environment in the user's shell: `NSTACK_LINEAR_CONVEX_URL` is the same deployment's `.convex.site` origin (no path), and `NSTACK_LINEAR_WEB_URL` is the Next.js site's origin. `LINEAR_API_KEY` is an optional explicit developer override sent per request through Convex; it is not saved by this service.

The web package's `convex:dev` and `convex:deploy` scripts invoke the root Convex project. To deploy functions, run `bun run --bun convex:deploy` at the repository root or `bun run --cwd apps/web --bun convex:deploy`. Deploy the Next.js app separately using its hosting provider and the two `NEXT_PUBLIC_*` settings above.

## Security and tests

The browser only starts OAuth and displays status. OAuth state, PKCE verifier, provider-token exchange/refresh, encrypted token storage, CLI session issuance/revocation, and Linear GraphQL requests stay in Convex functions. Keep all Convex secrets in deployment environment variables. Never expose OAuth client secrets or `LINEAR_TOKEN_ENCRYPTION_KEY` as `NEXT_PUBLIC_*` values. Local environment files and Convex deployment state are ignored by Git.

Run the focused UI and Convex fake-provider tests with `bun run --cwd apps/web test`. They do not require a Linear account or deployment.
