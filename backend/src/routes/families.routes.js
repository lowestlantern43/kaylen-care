import { Router } from "express";
import { query, withTransaction } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { requireFamilyMember, requireRole } from "../middleware/familyAccess.js";
import { requirePlanAccess } from "../middleware/planAccess.js";
import { buildPlanAccess } from "../services/planAccess.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest } from "../utils/httpError.js";
import { optionalString, requireString } from "../validators/simple.js";

export const familiesRouter = Router();

familiesRouter.use(requireAuth);

function optionalEmergencyContacts(body) {
  const contacts = body?.emergencyContacts;

  if (!Array.isArray(contacts)) {
    return [];
  }

  return contacts.slice(0, 2).map((contact) => ({
    name: typeof contact?.name === "string" ? contact.name.trim() : "",
    relationship:
      typeof contact?.relationship === "string" ? contact.relationship.trim() : "",
    phone: typeof contact?.phone === "string" ? contact.phone.trim() : "",
    notes: typeof contact?.notes === "string" ? contact.notes.trim() : "",
  }));
}

familiesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `
        SELECT
          f.id,
          f.name,
          f.timezone,
          f.address,
          f.emergency_contacts AS "emergencyContacts",
          fm.role,
          COALESCE(s.status, 'trialing') AS "subscriptionStatus",
          COALESCE(s.plan, 'trial') AS plan,
          s.trial_ends_at AS "trialEndsAt",
          s.access_paused_at AS "accessPausedAt",
          count(DISTINCT c.id)::int AS "childCount",
          count(DISTINCT active_fm.id)::int AS "memberCount",
          f.created_at AS "createdAt"
        FROM family_members fm
        INNER JOIN families f ON f.id = fm.family_id
        LEFT JOIN subscriptions s ON s.family_id = f.id
        LEFT JOIN children c ON c.family_id = f.id AND c.deleted_at IS NULL
        LEFT JOIN family_members active_fm ON active_fm.family_id = f.id AND active_fm.deleted_at IS NULL
        WHERE fm.user_id = $1
          AND fm.deleted_at IS NULL
          AND f.deleted_at IS NULL
        GROUP BY f.id, fm.role, s.status, s.plan, s.trial_ends_at, s.access_paused_at
        ORDER BY f.created_at ASC
      `,
      [req.user.id],
    );

    res.json({
      data: rows.map((row) => ({ ...row, access: buildPlanAccess(row) })),
      error: null,
    });
  }),
);

familiesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const name = requireString(req.body, "name", "Family name");
    const timezone = optionalString(req.body, "timezone") || "Europe/London";

    const family = await withTransaction(async (client) => {
      const existingFamilies = await client.query(
        `
          SELECT count(*)::int AS count
          FROM family_members fm
          INNER JOIN families f ON f.id = fm.family_id
          WHERE fm.user_id = $1
            AND fm.deleted_at IS NULL
            AND f.deleted_at IS NULL
        `,
        [req.user.id],
      );

      if (existingFamilies.rows[0]?.count > 0) {
        throw badRequest("Trial accounts can use one family workspace.");
      }

      const created = await client.query(
        `
          INSERT INTO families (name, timezone, created_by_user_id)
          VALUES ($1, $2, $3)
          RETURNING id, name, timezone, created_at AS "createdAt"
        `,
        [name, timezone, req.user.id],
      );

      await client.query(
        "INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, 'owner')",
        [created.rows[0].id, req.user.id],
      );

      await client.query(
        `
          INSERT INTO subscriptions (
            family_id,
            status,
            plan,
            trial_started_at,
            trial_ends_at
          )
          VALUES ($1, 'trialing', 'trial', now(), now() + interval '30 days')
        `,
        [created.rows[0].id],
      );

      return created.rows[0];
    });

    res.status(201).json({ data: family, error: null });
  }),
);

familiesRouter.get(
  "/:familyId",
  requireFamilyMember,
  (req, res) => {
    res.json({
      data: {
        id: req.familyMember.family_id,
        name: req.familyMember.family_name,
        role: req.familyMember.role,
      },
      error: null,
    });
  },
);

familiesRouter.patch(
  "/:familyId",
  requireFamilyMember,
  requireRole("owner"),
  requirePlanAccess("write"),
  asyncHandler(async (req, res) => {
    const name = requireString(req.body, "name", "Family name");
    const timezone = optionalString(req.body, "timezone") || "Europe/London";
    const address = optionalString(req.body, "address");
    const emergencyContacts = optionalEmergencyContacts(req.body);

    const { rows } = await query(
      `
        UPDATE families
        SET name = $1,
            timezone = $2,
            address = $3,
            emergency_contacts = $4
        WHERE id = $5 AND deleted_at IS NULL
        RETURNING
          id,
          name,
          timezone,
          address,
          emergency_contacts AS "emergencyContacts",
          updated_at AS "updatedAt"
      `,
      [
        name,
        timezone,
        address,
        JSON.stringify(emergencyContacts),
        req.familyMember.family_id,
      ],
    );

    res.json({ data: rows[0], error: null });
  }),
);
