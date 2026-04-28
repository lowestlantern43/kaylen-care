import express from "express";
import { Router } from "express";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, forbidden, notFound } from "../utils/httpError.js";
import { requireEnum, requireString, requireUuid } from "../validators/simple.js";
import {
  buildProfilePhotoObjectKey,
  buildPublicSpacesUrl,
  createSignedPutUrl,
} from "../services/spaces.js";

export const uploadsRouter = Router();

const writableRoles = new Set(["owner", "parent"]);
const allowedImageTypes = ["image/jpeg", "image/png", "image/webp"];

uploadsRouter.use(requireAuth);

async function assertWritableChild({ familyId, childId, userId }) {
  const membership = await query(
    `
      SELECT role
      FROM family_members
      WHERE family_id = $1
        AND user_id = $2
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [familyId, userId],
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
}

uploadsRouter.post(
  "/profile-photo/sign",
  asyncHandler(async (req, res) => {
    const familyId = requireUuid(req.body.familyId, "Family ID");
    const childId = requireUuid(req.body.childId, "Child ID");
    requireString(req.body, "fileName", "File name");
    const fileType = requireEnum(
      req.body,
      "fileType",
      allowedImageTypes,
      "File type",
    );

    await assertWritableChild({ familyId, childId, userId: req.user.id });

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

uploadsRouter.post(
  "/profile-photo",
  express.raw({ type: allowedImageTypes, limit: "8mb" }),
  asyncHandler(async (req, res) => {
    const familyId = requireUuid(req.query.familyId, "Family ID");
    const childId = requireUuid(req.query.childId, "Child ID");
    const fileName = String(req.get("x-file-name") || req.query.fileName || "");
    requireString({ fileName }, "fileName", "File name");

    const fileType = String(req.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();

    if (!allowedImageTypes.includes(fileType)) {
      throw badRequest("Profile photos must be JPG, PNG, or WebP images.");
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw badRequest("Choose a photo to upload.");
    }

    await assertWritableChild({ familyId, childId, userId: req.user.id });

    const objectKey = buildProfilePhotoObjectKey({
      familyId,
      childId,
      fileType,
    });
    const publicUrl = buildPublicSpacesUrl(objectKey);
    const uploadResponse = await fetch(
      createSignedPutUrl({ objectKey, fileType }),
      {
        method: "PUT",
        headers: {
          "Content-Type": fileType,
        },
        body: req.body,
      },
    );

    if (!uploadResponse.ok) {
      const details = await uploadResponse.text().catch(() => "");
      throw badRequest(
        `DigitalOcean Spaces upload failed (${uploadResponse.status}). ${
          details || "Check the Spaces bucket, region, endpoint, and access key permissions."
        }`,
      );
    }

    const { rows } = await query(
      `
        UPDATE children
        SET avatar_url = $1
        WHERE id = $2
          AND family_id = $3
          AND deleted_at IS NULL
        RETURNING
          id,
          first_name AS "firstName",
          last_name AS "lastName",
          date_of_birth::text AS "dateOfBirth",
          nhs_number AS "nhsNumber",
          avatar_url AS "avatarUrl",
          notes,
          updated_at AS "updatedAt"
      `,
      [publicUrl, childId, familyId],
    );

    if (!rows[0]) {
      throw notFound("Child not found.");
    }

    res.json({
      data: {
        publicUrl,
        objectKey,
        child: rows[0],
      },
      error: null,
    });
  }),
);
