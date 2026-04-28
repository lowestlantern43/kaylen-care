# FamilyTrack SaaS Architecture

## Recommended Project Structure

Keep the current working app intact while building the SaaS foundation beside it. The end state should be:

```text
kaylens-diary-saas/
  frontend/
    src/
      api/
      components/
      features/
        auth/
        onboarding/
        families/
        children/
        diary/
        reports/
      App.jsx
      main.jsx
      index.css
    package.json
    vite.config.js
  backend/
    src/
      controllers/
      db/
      middleware/
      routes/
      services/
      validators/
      app.js
      server.js
    package.json
  database/
    migrations/
      001_initial_saas_schema.sql
    schema.sql
    seed.sql
  docs/
    architecture.md
    api-plan.md
    migration-plan.md
    build-order.md
```

During the transition, this repository can keep the existing root Vite app and add `backend/`, `database/`, and `docs/`. Once the API and frontend migration are ready, move the React app into `frontend/` as a deliberate step.

## Target Stack

- Frontend: React, Vite, Tailwind CSS.
- Backend: Node.js, Express.
- Database: DigitalOcean Managed PostgreSQL.
- File storage: DigitalOcean Spaces.
- Payments: Stripe subscriptions.
- Hosting: DigitalOcean App Platform.

React must only call the backend API. It must not connect to PostgreSQL, expose database credentials, or use Supabase in the SaaS version.

## Data Ownership Model

- A `user` is a real login identity.
- A `family` is the shared workspace and billing owner.
- `family_members` connects users to families and stores each user's role.
- `children` belong to a family.
- `care_logs` belong to a family, child, and creator user.
- `subscriptions` belong to a family.
- `invitations` allow extra parents/carers/viewers to join a family.

This means Martin can create Bellamy Family, add Kaylen, invite Rachel, and both users can add/view Kaylen's logs under the same subscription.

## Reuse From Current App

The existing app should be treated as the visual and workflow reference, not thrown away.

Reusable pieces in `src/KaylenCareMonitorDashboard.jsx`:

- Overall mobile-first diary dashboard layout.
- Category tiles for Food Diary, Medication, Toileting, Health, Sleep, and Reports.
- Existing Tailwind tone: white/slate cards, soft category colours, rounded panels, simple controls.
- Food form fields: date, time, location, item, amount, notes, saved food choices.
- Medication form fields: medicine, dose, time, given by, date, notes, saved medication/given-by choices.
- Toileting form fields: date, time, entry, notes.
- Health form fields: event, duration, happened, action, notes, weight, height, BMI calculation.
- Sleep flow: log bedtime first, later find the latest incomplete sleep entry and add wake time.
- Report features: recent timeline, category grouping, date range filtering, category filtering, compact report view.
- PDF export using `html2canvas` and `jspdf`.
- Pull-to-refresh interaction and simple latest-entry summaries.

Replace rather than reuse:

- Hardcoded PIN auth.
- Direct Supabase client calls from React.
- Single-child assumptions in display labels and queries.
- Supabase Edge/Netlify widget summary as the long-term backend.

## Backend Responsibility

The backend owns:

- Password hashing and auth sessions.
- Request validation.
- Family membership checks.
- Role/permission checks.
- Subscription checks.
- PostgreSQL queries.
- Stripe checkout and webhook handling.
- DigitalOcean Spaces signed upload/download flows.
- Audit logging for sensitive actions.

## Frontend Responsibility

The frontend owns:

- Login/signup screens.
- Onboarding flow.
- Family and child selection.
- Diary forms and report UI.
- Calling API endpoints with credentials.
- Friendly loading, empty, and error states.

The frontend should keep the existing app feeling: quick to open, clear current child, and easy to log from a phone.

## Environment Variables

Frontend:

```text
VITE_API_BASE_URL=http://localhost:4000
```

Backend:

```text
DATABASE_URL=postgres://...
SESSION_SECRET=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
DO_SPACES_KEY=...
DO_SPACES_SECRET=...
DO_SPACES_BUCKET=...
DO_SPACES_REGION=...
FRONTEND_URL=http://localhost:5173
```

Use `SESSION_SECRET` with secure HTTP-only cookies for browser sessions. A JWT approach is possible, but cookies are the safer default for this app because it stores child care and health-related information.
