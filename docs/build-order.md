# Step-by-Step Build Order

## Phase 1: Foundation

1. Add database schema and migrations.
2. Add backend package with Express, PostgreSQL connection, env loading, and health check.
3. Add backend auth with secure password hashing and HTTP-only session cookies.
4. Add middleware for `requireAuth`, `requireFamilyMember`, and `requireRole`.
5. Add family creation and owner membership.
6. Add child CRUD.

## Phase 2: Diary API

1. Add generic `care_logs` create/list/update/delete endpoints.
2. Add category validation for food, medication, sleep, toileting, health, and general notes.
3. Add latest incomplete sleep endpoint.
4. Add sleep start/complete endpoints.
5. Add report timeline endpoint.
6. Add report summary endpoint.

## Phase 3: Frontend Migration

1. Add API client using `VITE_API_BASE_URL`.
2. Replace hardcoded PIN with login/signup.
3. Add onboarding: sign up, create family, add first child, go to dashboard, invite another parent/carer.
4. Add family selector if a user belongs to more than one family.
5. Add child selector everywhere logs/reports need it.
6. Replace Supabase reads/writes with API calls one category at a time.
7. Keep the existing forms and report UI while changing their data source.

## Phase 4: Invitations and Roles

1. Add invitation creation.
2. Add invitation acceptance.
3. Add family members screen.
4. Enforce owner/parent/carer/viewer permissions in UI and API.
5. Add audit logs for invites, role changes, deletes, exports, and subscription actions.

## Phase 5: Subscriptions

1. Add `subscriptions` API read endpoint.
2. Add Stripe checkout session creation.
3. Add Stripe billing portal session creation.
4. Add Stripe webhook verification and subscription table updates.
5. Add server-side premium access checks.
6. Show subscription status and billing action to owners.

## Phase 6: Files and Exports

1. Keep client-side PDF export initially because the current app already works.
2. Add DigitalOcean Spaces signed upload endpoint.
3. Add attachment metadata later if care-log file attachments become part of the product.
4. Consider server-side PDF generation only if client-side PDFs become unreliable.

## Phase 7: Deployment

1. Create DigitalOcean Managed PostgreSQL.
2. Create DigitalOcean Spaces bucket.
3. Deploy backend service to DigitalOcean App Platform.
4. Deploy frontend static site to DigitalOcean App Platform.
5. Configure environment variables.
6. Configure Stripe webhook URL.
7. Run migrations against production database.
8. Test signup, invitation, child switching, logging, reports, PDF export, and subscription status.

## Access-Control Rules

Every backend route starts from the authenticated user and validates membership before data access.

Roles:

- `owner`: manage subscription, invite/remove members, manage children, add/edit/delete logs, view/export reports.
- `parent`: manage children, add/edit/delete logs, view/export reports.
- `carer`: add logs and view relevant logs/reports.
- `viewer`: view only.

Rules:

- Users can only list families where they are active members.
- Users can only list children for families where they are active members.
- Every care log query must include `family_id`.
- When creating a care log, the backend must verify the child belongs to the family.
- When updating/deleting a care log, the backend must verify the log belongs to the family.
- Subscription state must be checked server-side for premium-only features.
- Viewer role cannot create, edit, delete, invite, or manage billing.
- Carer role cannot manage children, members, or subscriptions.
- Only owner role can manage billing and member roles.

## Local Run Commands

Current app:

```bash
npm install
npm run dev
```

Future backend:

```bash
cd backend
npm install
npm run dev
```

Future frontend after split:

```bash
cd frontend
npm install
npm run dev
```

Database migration with `psql`:

```bash
psql "$DATABASE_URL" -f database/migrations/001_initial_saas_schema.sql
```
