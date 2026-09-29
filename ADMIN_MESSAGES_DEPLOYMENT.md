# MAP Energy admin messages deployment

The page is protected by the existing Cloudflare Access application. Its destinations must include both `map-energy/admin-messages` and `map-energy/admin-messages/*`.

The static page is published with the existing website. A dedicated route-only Worker in `admin-messages-proxy/` handles the same-origin API without changing the rest of aptica.uk.

## Worker configuration

The Access team domain and AUD tag are configured in `admin-messages-proxy/wrangler.jsonc`.

Store these only as encrypted Worker secrets:

- `ADMIN_EMAILS`: comma-separated lower-case email addresses explicitly permitted to use this admin tool.
- `ADMIN_SECRET`: the existing staging Worker's admin secret.
- `ADMIN_SECRET_PRODUCTION`: the production Worker's admin secret.

The proxy cryptographically validates the Cloudflare Access JWT, checks its audience and permitted email, applies same-origin double-submit CSRF protection, and only exposes the fixed admin-message routes. Production is the default; `?environment=staging` selects staging.

From `aptica-web/admin-messages-proxy`:

```text
npx wrangler secret put ADMIN_SECRET
npx wrangler secret put ADMIN_EMAILS
npx wrangler deploy
```

Enter the secret only in Wrangler's hidden prompt. Never put its value in a command, repository, browser, message, or screenshot.
