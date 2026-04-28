import { Router } from "express";
import crypto from "node:crypto";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { requireFamilyMember, requireRole } from "../middleware/familyAccess.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { requireEmail, requireString, requireUuid } from "../validators/simple.js";

export const membersRouter = Router({ mergeParams: true });

const roles = new Set(["owner", "parent", "carer", "viewer"]);

membersRouter.use(requireAuth, requireFamilyMember);

function requireRoleValue(body) {
  const role = requireString(body, "role", "Role");
  if (!roles.has(role)) throw badRequest("Role is not supported.");
  return role;
}

membersRouter.get(
  "/",
  requireRole("owner", "parent"),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `
        SELECT
          fm.id,
          fm.user_id AS "userId",
          u.full_name AS "fullName",
          u.email,
          fm.role,
          fm.joined_at AS "joinedAt"
        FROM family_members fm
        INNER JOIN users u ON u.id = fm.user_id
        WHERE fm.family_id = $1
          AND fm.deleted_at IS NULL
        ORDER BY
          CASE fm.role
            WHEN 'owner' THEN 1
            WHEN 'parent' THEN 2
            WHEN 'carer' THEN 3
            ELSE 4
          END,
          u.full_name ASC
      `,
      [req.familyMember.family_id],
    );

    res.json({ data: rows, error: null });
  }),
);

membersRouter.patch(
  "/:memberId",
  requireRole("owner"),
  asyncHandler(async (req, res) => {
    const memberId = requireUuid(req.params.memberId, "Member ID");
    const role = requireRoleValue(req.body);

    const { rows } = await query(
      `
        UPDATE family_members
        SET role = $1
        WHERE id = $2
          AND family_id = $3
          AND deleted_at IS NULL
        RETURNING id, user_id AS "userId", role
      `,
      [role, memberId, req.familyMember.family_id],
    );

    if (!rows[0]) throw notFound("Member not found.");
    res.json({ data: rows[0], error: null });
  }),
);

membersRouter.delete(
  "/:memberId",
  requireRole("owner"),
  asyncHandler(async (req, res) => {
    const memberId = requireUuid(req.params.memberId, "Member ID");

    if (memberId === req.familyMember.id) {
      throw badRequest("You cannot remove your own owner membership.");
    }

    const { rows } = await query(
      `
        UPDATE family_members
        SET deleted_at = now()
        WHERE id = $1
          AND family_id = $2
          AND deleted_at IS NULL
        RETURNING id
      `,
      [memberId, req.familyMember.family_id],
    );

    if (!rows[0]) throw notFound("Member not found.");
    res.json({ data: { id: rows[0].id, deleted: true }, error: null });
  }),
);

membersRouter.get(
  "/invitations",
  requireRole("owner"),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `
        SELECT
          id,
          email,
          role,
          expires_at AS "expiresAt",
          accepted_at AS "acceptedAt",
          revoked_at AS "revokedAt",
          created_at AS "createdAt"
        FROM invitations
        WHERE family_id = $1
        ORDER BY created_at DESC
        LIMIT 50
      `,
      [req.familyMember.family_id],
    );

    res.json({ data: rows, error: null });
  }),
);

membersRouter.post(
  "/invitations",
  requireRole("owner"),
  asyncHandler(async (req, res) => {
    const email = requireEmail(req.body);
    const role = requireRoleValue(req.body);
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const { rows } = await query(
      `
        INSERT INTO invitations (
          family_id,
          email,
          role,
          token_hash,
          invited_by_user_id,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, now() + interval '14 days')
        RETURNING
          id,
          email,
          role,
          expires_at AS "expiresAt",
          created_at AS "createdAt"
      `,
      [req.familyMember.family_id, email, role, tokenHash, req.user.id],
    );

    res.status(201).json({
      data: {
        ...rows[0],
        acceptUrl: `/accept-invitation?token=${token}`,
      },
      error: null,
    });
  }),
);
