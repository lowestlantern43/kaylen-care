import { Router } from "express";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { forbidden, notFound } from "../utils/httpError.js";
import { requireEnum, requireString, requireUuid } from "../validators/simple.js";
import {
  buildProfilePhotoObjectKey,
  buildPublicSpacesUrl,
  createSignedPutUrl,
} from "../services/spaces.js";

export const uploadsRouter = Router();

const writableRoles = new Set(["owner", "parent"]);

uploadsRouter.use(requireAuth);

uploadsRouter.post(
  "/profile-photo/sign",
  asyncHandler(async (req, res) => {
    const familyId = requireUuid(req.body.familyId, "Family ID");
    const childId = requireUuid(req.body.childId, "Child ID");
    requireString(req.body, "fileName", "File name");
    const fileType = requireEnum(
      req.body,
      "fileType",
      ["image/jpeg", "image/png", "image/webp"],
      "File type",
    );

    const membership = await query(
      `
        SELECT role
        FROM family_members
        WHERE family_id = $1
          AND user_id = $2
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [familyId, req.user.id],
    );

    if (!membership.rows[0]) {
      throw notFound("Family not found.");
    }

    if (!writableRoles.has(membership.rows[0].role)) {
      throw forbidden("Only owners and parents can update child profile photos.");
    }

    const child = await query(
      `
        SELECT id
        FROM children
        WHERE id = $1
          AND family_id = $2
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [childId, familyId],
    );

    if (!child.rows[0]) {
      throw notFound("Child not found.");
    }

    const objectKey = buildProfilePhotoObjectKey({
      familyId,
      childId,
      fileType,
    });

    res.json({
      data: {
        signedUploadUrl: createSignedPutUrl({ objectKey, fileType }),
        publicUrl: buildPublicSpacesUrl(objectKey),
        objectKey,
      },
      error: null,
    });
  }),
);
