# FamilyTrack DigitalOcean Deployment

This deploys FamilyTrack as one DigitalOcean App Platform app:

- `web`: React/Vite static site at `/`
- `api`: Node/Express service at `/api`
- Database: existing DigitalOcean Managed PostgreSQL

The frontend should use `VITE_API_BASE_URL=/api` in production. This keeps the
browser and API on the same DigitalOcean app URL, which is simpler for cookies
and CORS.

## Before You Start

1. Push this project to GitHub, GitLab, or Bitbucket.
2. Make sure the DigitalOcean PostgreSQL database exists.
3. Make sure all migrations have been applied to that database.
4. Rotate any live secrets that have been copied into chat, screenshots, or
   plain notes.

## DigitalOcean App Platform Setup

1. In DigitalOcean, go to **Create** > **App Platform**.
2. Choose the repository for this project.
3. Add two components:
   - **Web Service** for `backend`
   - **Static Site** for the React app at the repo root

## API Component

Use these settings:

- Component type: Web Service
- Name: `api`
- Source directory: `backend`
- Build command: `npm ci`
- Run command: `npm start`
- HTTP port: `4000`
- Route: `/api`
- Health check path: `/api/health/db`

Runtime environment variables:

| Key | Scope | Secret? | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | Runtime | No | `production` |
| `DATABASE_URL` | Runtime | Yes | DigitalOcean PostgreSQL connection string with SSL |
| `SESSION_SECRET` | Runtime | Yes | Long random string |
| `FRONTEND_URL` | Runtime | No | DigitalOcean app URL, then custom domain later |
| `STRIPE_SECRET_KEY` | Runtime | Yes | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Runtime | Yes | Stripe webhook signing secret |
| `STRIPE_PRICE_ID` | Runtime | No | Stripe recurring price ID |

## Web Component

Use these settings:

- Component type: Static Site
- Name: `web`
- Source directory: `/`
- Build command: `npm ci && npm run build`
- Output directory: `dist`
- Route: `/`
- Catch-all document: `index.html`

Build-time environment variables:

| Key | Scope | Secret? | Notes |
| --- | --- | --- | --- |
| `VITE_API_BASE_URL` | Build time | No | `/api` |
| `VITE_DO_SPACES_ENDPOINT` | Build time | No | Example: `https://lon1.digitaloceanspaces.com` |
| `VITE_DO_SPACES_BUCKET` | Build time | No | Spaces bucket name |
| `VITE_DO_SPACES_REGION` | Build time | No | Spaces region |
| `VITE_DO_SPACES_PUBLIC_URL` | Build time | No | Public CDN or bucket URL |

Do not expose DigitalOcean Spaces secret keys in frontend variables. Profile
photo uploads need a backend signed-upload endpoint before they can upload
directly to Spaces.

## First Deploy Test

After the app deploys:

1. Open the DigitalOcean app URL.
2. Visit `/api/health/db` on the same domain.
3. Log in with the existing test/admin account.
4. Create a test family/child if needed.
5. Add one food log and one sleep log.
6. Open Reports and export a PDF.

## Stripe Webhook

After the app has a public URL, update Stripe webhook endpoint to:

```text
https://YOUR-DIGITALOCEAN-APP-URL/api/stripe/webhook
```

Recommended events:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

Copy the new webhook signing secret into DigitalOcean as
`STRIPE_WEBHOOK_SECRET`.

## Custom Domain Later

When the test app works, add the real domain in DigitalOcean App Platform and
then update:

- `FRONTEND_URL`
- Stripe success/cancel URLs if configured
- Stripe webhook endpoint

## Local Commands

Frontend:

```bash
npm install
npm run dev
```

Backend:

```bash
cd backend
npm install
npm run migrate
npm start
```

Production build check:

```bash
npm run build
```
