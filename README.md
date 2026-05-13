# FamilyTrack

FamilyTrack is a mobile-first family care diary for logging food, drink,
medication, sleep, toileting, health notes, care reports, and PDF exports.

## Stack

- React + Vite + Tailwind
- Node.js + Express API
- PostgreSQL for SaaS data
- Supabase Storage is still used by this existing app version for child photo
  uploads
- Stripe subscription structure
- DigitalOcean App Platform deployment target

## Local Setup

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

The local Vite server proxies `/api` to the backend on port `4000`.

## Environment Files

Copy the examples and fill in local values:

```bash
copy .env.example .env
copy backend\.env.example backend\.env
```

Do not commit real `.env` files.

## Stripe Setup

Stripe secret values belong on the backend only, for example in DigitalOcean
App Platform environment variables for the backend service.

Required backend variables:

```bash
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_MONTHLY_PRICE_ID=price_...              # FamilyTrack monthly subscription - £4.99
STRIPE_DOCUMENTS_50GB_PRICE_ID=price_...           # FamilyTrack Documents - 50GB - £2
STRIPE_DOCUMENTS_100GB_PRICE_ID=price_...          # FamilyTrack Documents - 100GB - £3
FAMILYTRACK_PRO_TRIAL_DAYS=14
FAMILY_PLAN_MONTHLY_PRICE_GBP=4.99
```

In Stripe, open **Product catalog**, choose the product/price, and copy the
Price ID that starts with `price_`. Use:

- `STRIPE_PRO_MONTHLY_PRICE_ID` for **FamilyTrack monthly subscription - £4.99**
- `STRIPE_DOCUMENTS_50GB_PRICE_ID` for **FamilyTrack Documents - 50GB - £2**
- `STRIPE_DOCUMENTS_100GB_PRICE_ID` for **FamilyTrack Documents - 100GB - £3**

Stripe webhooks should post to `/api/stripe/webhook` and include subscription,
checkout session, and invoice events. Missing Stripe config now shows a clear
admin/developer error instead of failing silently.

Also set `PUBLIC_APP_URL=https://familytrack.care` in the backend environment so
Stripe Checkout returns to the live app instead of localhost. Set
`PLATFORM_ADMIN_EMAILS=owner@example.com` as a comma-separated recovery list for
owner/admin accounts; these accounts bypass customer billing checks for the
owner platform.

Owner/admins can adjust public pricing, promo visibility, trial length display,
and Secure Document Storage tiers from the Owner Platform storage/pricing area.
Do not put Stripe secret keys or secret webhook values in frontend `VITE_*`
variables.

## Build Check

```bash
npm run build
```

## DigitalOcean Deployment

See `docs/deployment-digitalocean.md`.
