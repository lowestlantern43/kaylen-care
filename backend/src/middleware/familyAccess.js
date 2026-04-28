import { query } from "../db/pool.js";
import { forbidden, notFound } from "../utils/httpError.js";
import { requireUuid } from "../validators/simple.js";

const roleRank = {
  viewer: 1,
  carer: 2,
  parent: 3,
  owner: 4,
};

export async function requireFamilyMember(req, res, next) {
  try {
    const familyId = requireUuid(req.params.familyId, "Family ID");

    const { rows } = await query(
      `
        SELECT
          fm.id,
          fm.family_id,
          fm.user_id,
          fm.role,
          f.name AS family_name,
          f.platform_status
        FROM family_members fm
        INNER JOIN families f ON f.id = fm.family_id
        WHERE fm.family_id = $1
          AND fm.user_id = $2
          AND fm.deleted_at IS NULL
          AND f.deleted_at IS NULL
        LIMIT 1
      `,
      [familyId, req.user.id],
    );

    if (!rows[0]) {
      throw notFound("Family not found.");
    }

    if (
      rows[0].platform_status === "suspended" &&
      !req.user.is_platform_admin
    ) {
      throw forbidden("This family workspace is currently suspended.");
    }

    req.familyMember = rows[0];
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.familyMember || !allowedRoles.includes(req.familyMember.role)) {
      next(forbidden());
      return;
    }

    next();
  };
}

export function requireAtLeastRole(minimumRole) {
  return (req, res, next) => {
    const currentRank = roleRank[req.familyMember?.role] || 0;
    const minimumRank = roleRank[minimumRole] || 0;

    if (currentRank < minimumRank) {
      next(forbidden());
      return;
    }

    next();
  };
}
