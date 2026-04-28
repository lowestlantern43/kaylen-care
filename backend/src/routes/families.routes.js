import { Router } from "express";
import { query, withTransaction } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { requireFamilyMember, requireRole } from "../middleware/familyAccess.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { optionalString, requireString } from "../validators/simple.js";

export const familiesRouter = Router();

familiesRouter.use(requireAuth);

familiesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `
        SELECT
          f.id,
          f.name,
          f.timezone,
          fm.role,
          f.created_at AS "createdAt"
        FROM family_members fm
        INNER JOIN families f ON f.id = fm.family_id
        WHERE fm.user_id = $1
          AND fm.deleted_at IS NULL
          AND f.deleted_at IS NULL
        ORDER BY f.created_at ASC
      `,
      [req.user.id],
    );

    res.json({ data: rows, error: null });
  }),
);

familiesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const name = requireString(req.body, "name", "Family name");
    const timezone = optionalString(req.body, "timezone") || "Europe/London";

    const family = await withTransaction(async (client) => {
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
        "INSERT INTO subscriptions (family_id, status, plan) VALUES ($1, 'inactive', 'free')",
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
  asyncHandler(async (req, res) => {
    const name = requireString(req.body, "name", "Family name");
    const timezone = optionalString(req.body, "timezone") || "Europe/London";

    const { rows } = await query(
      `
        UPDATE families
        SET name = $1, timezone = $2
        WHERE id = $3 AND deleted_at IS NULL
        RETURNING id, name, timezone, updated_at AS "updatedAt"
      `,
      [name, timezone, req.familyMember.family_id],
    );

    res.json({ data: rows[0], error: null });
  }),
);
