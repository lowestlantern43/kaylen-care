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

## Build Check

```bash
npm run build
```

## DigitalOcean Deployment

See `docs/deployment-digitalocean.md`.
