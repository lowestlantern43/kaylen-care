# Backend API Plan

Base URL in local development: `http://localhost:4000/api`.

All protected routes require an authenticated session. Every route that accepts `familyId`, `childId`, `logId`, or `memberId` must verify the current user belongs to that family before returning or changing data.

## Auth

- `POST /auth/signup`
  - Creates a user with a securely hashed password.
  - Optionally creates the first family during onboarding.
- `POST /auth/login`
  - Verifies password and creates a secure HTTP-only session cookie.
- `POST /auth/logout`
  - Clears the session cookie.
- `GET /auth/me`
  - Returns current user and memberships.
- `POST /auth/password-reset/request`
  - Planned endpoint. Creates a short-lived reset token and emails the user.
- `POST /auth/password-reset/confirm`
  - Planned endpoint. Sets a new password after token verification.

## Families

- `GET /families`
  - Lists families where the user is an active member.
- `POST /families`
  - Creates a family and owner membership.
- `GET /families/:familyId`
  - Returns family details after membership check.
- `PATCH /families/:familyId`
  - Owner only. Updates family name/timezone.

## Family Members

- `GET /families/:familyId/members`
  - Owner/parent can list members. Carer/viewer can receive limited display data if needed.
- `PATCH /families/:familyId/members/:memberId`
  - Owner only. Changes a member role.
- `DELETE /families/:familyId/members/:memberId`
  - Owner only. Removes a member.

## Invitations

- `POST /families/:familyId/invitations`
  - Owner only by default. Invites an email as parent/carer/viewer.
- `GET /invitations/:token`
  - Reads invitation status without exposing family data unnecessarily.
- `POST /invitations/:token/accept`
  - Authenticated user accepts invitation, or new user signs up first then accepts.
- `POST /families/:familyId/invitations/:invitationId/revoke`
  - Owner only.

## Children

- `GET /families/:familyId/children`
  - All roles can list active children.
- `POST /families/:familyId/children`
  - Owner/parent only.
- `PATCH /families/:familyId/children/:childId`
  - Owner/parent only.
- `DELETE /families/:familyId/children/:childId`
  - Owner/parent only. Soft delete.

## Care Logs

- `GET /families/:familyId/care-logs`
  - Filters: `childId`, `category`, `startDate`, `endDate`, `limit`, `cursor`.
  - All roles can read logs for families they belong to.
- `POST /families/:familyId/care-logs`
  - Owner/parent/carer can create.
  - Server checks that `child_id` belongs to `family_id`.
- `PATCH /families/:familyId/care-logs/:logId`
  - Owner/parent can edit any log. Carer can edit own logs if product rules allow.
- `DELETE /families/:familyId/care-logs/:logId`
  - Owner/parent can soft delete. Carer can delete own logs if product rules allow.
- `GET /families/:familyId/children/:childId/sleep/incomplete`
  - Returns latest incomplete sleep log for that child.
- `POST /families/:familyId/children/:childId/sleep/start`
  - Creates a sleep log with bedtime and no wake time.
- `PATCH /families/:familyId/care-logs/:logId/sleep/complete`
  - Completes the incomplete sleep entry with wake time and calculates report duration server-side or returns enough data for reports.

## Reports

- `GET /families/:familyId/reports/timeline`
  - Returns logs grouped by date for the selected child/date/category filters.
- `GET /families/:familyId/reports/summary`
  - Returns totals and trends such as sleep minutes, milk amount, health measurements.
- `POST /families/:familyId/reports/pdf`
  - Later option if PDF generation moves server-side. Initial SaaS can keep client-side PDF export using API data.

## Subscriptions

- `GET /families/:familyId/subscription`
  - Owner can view billing status.
- `POST /families/:familyId/subscription/checkout`
  - Owner only. Creates a Stripe checkout session for the family.
- `POST /families/:familyId/subscription/portal`
  - Owner only. Creates a Stripe billing portal session.
- `POST /stripe/webhook`
  - Public route with Stripe signature verification.
  - Updates the `subscriptions` table from Stripe events.

## File Uploads

- `POST /families/:familyId/uploads/presign`
  - Owner/parent/carer can request a signed DigitalOcean Spaces upload URL.
  - Server controls allowed content types, size limits, and object prefixes.

## Validation

Use a small validation layer in `backend/src/validators`. Keep it understandable. `zod` is a reasonable choice, but plain validation helpers are acceptable for the first pass if they stay clear.

## API Response Shape

Use consistent JSON:

```json
{
  "data": {},
  "error": null
}
```

For errors:

```json
{
  "data": null,
  "error": {
    "code": "forbidden",
    "message": "You do not have permission to do that."
  }
}
```
