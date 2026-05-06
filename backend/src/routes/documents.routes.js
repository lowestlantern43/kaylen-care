import express from "express";
import { Router } from "express";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import {
  requireAtLeastRole,
  requireFamilyMember,
} from "../middleware/familyAccess.js";
import { requirePlanAccess } from "../middleware/planAccess.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, notFound } from "../utils/httpError.js";
import {
  optionalDate,
  optionalString,
  requireEnum,
  requireString,
  requireUuid,
} from "../validators/simple.js";
import {
  buildDocumentObjectKey,
  createSignedGetUrl,
  createSignedPrivatePutUrl,
  deleteSpacesObject,
  getDocumentExtension,
} from "../services/spaces.js";

export const documentsRouter = Router({ mergeParams: true });

const documentCategories = [
  "EHCP",
  "Diagnosis",
  "Hospital",
  "School",
  "Medication",
  "Therapy",
  "Benefits / DLA",
  "Other",
];

const allowedDocumentTypes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

documentsRouter.use(requireAuth, requireFamilyMember);

async function assertChildBelongsToFamily(childId, familyId) {
  if (!childId) return null;

  const { rows } = await query(
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

  if (!rows[0]) {
    throw badRequest("Selected child was not found in this family.");
  }

  return childId;
}

function mapDocument(row) {
  return {
    id: row.id,
    familyId: row.familyId,
    childId: row.childId,
    childName: row.childName,
    title: row.title,
    category: row.category,
    documentDate: row.documentDate,
    notes: row.notes,
    fileName: row.fileName,
    fileType: row.fileType,
    fileSizeBytes: row.fileSizeBytes,
    createdAt: row.createdAt,
    downloadUrl: `/api/families/${row.familyId}/documents/${row.id}/download`,
  };
}

documentsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const childId = req.query.childId
      ? requireUuid(String(req.query.childId), "Child ID")
      : null;
    const category = req.query.category ? String(req.query.category) : "";
    const search = optionalString(req.query, "search");

    if (childId) {
      await assertChildBelongsToFamily(childId, req.familyMember.family_id);
    }

    const params = [req.familyMember.family_id];
    const filters = ["d.family_id = $1", "d.deleted_at IS NULL"];

    if (childId) {
      params.push(childId);
      filters.push(`d.child_id = $${params.length}`);
    }

    if (category && category !== "All") {
      if (!documentCategories.includes(category)) {
        throw badRequest("Document category is not valid.");
      }
      params.push(category);
      filters.push(`d.category = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      filters.push(
        `(d.title ILIKE $${params.length} OR d.notes ILIKE $${params.length} OR d.file_name ILIKE $${params.length})`,
      );
    }

    const { rows } = await query(
      `
        SELECT
          d.id,
          d.family_id AS "familyId",
          d.child_id AS "childId",
          concat_ws(' ', c.first_name, c.last_name) AS "childName",
          d.title,
          d.category,
          d.document_date::text AS "documentDate",
          d.notes,
          d.file_name AS "fileName",
          d.file_type AS "fileType",
          d.file_size_bytes AS "fileSizeBytes",
          d.created_at AS "createdAt"
        FROM family_documents d
        LEFT JOIN children c ON c.id = d.child_id
        WHERE ${filters.join(" AND ")}
        ORDER BY d.document_date DESC NULLS LAST, d.created_at DESC
        LIMIT 200
      `,
      params,
    );

    res.json({ data: rows.map(mapDocument), error: null });
  }),
);

documentsRouter.post(
  "/",
  requireAtLeastRole("carer"),
  requirePlanAccess("write"),
  express.raw({ type: allowedDocumentTypes, limit: "25mb" }),
  asyncHandler(async (req, res) => {
    const title = requireString(req.query, "title", "Document title");
    const category = requireEnum(
      req.query,
      "category",
      documentCategories,
      "Document category",
    );
    const childId = req.query.childId
      ? requireUuid(String(req.query.childId), "Child ID")
      : null;
    const documentDate = optionalDate(req.query, "documentDate");
    const notes = optionalString(req.query, "notes");
    const fileName = requireString(req.query, "fileName", "File name");
    const fileType = String(req.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();

    if (!allowedDocumentTypes.includes(fileType)) {
      getDocumentExtension(fileType);
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw badRequest("Choose a document to upload.");
    }

    await assertChildBelongsToFamily(childId, req.familyMember.family_id);

    const objectKey = buildDocumentObjectKey({
      familyId: req.familyMember.family_id,
      childId,
      fileType,
    });

    const uploadResponse = await fetch(
      createSignedPrivatePutUrl({ objectKey, fileType }),
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
        `Document upload failed (${uploadResponse.status}). ${
          details ||
          "Check the Spaces bucket, region, endpoint, and access key permissions."
        }`,
      );
    }

    const { rows } = await query(
      `
        INSERT INTO family_documents (
          family_id,
          child_id,
          title,
          category,
          document_date,
          notes,
          file_name,
          file_type,
          file_size_bytes,
          object_key,
          created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING
          id,
          family_id AS "familyId",
          child_id AS "childId",
          title,
          category,
          document_date::text AS "documentDate",
          notes,
          file_name AS "fileName",
          file_type AS "fileType",
          file_size_bytes AS "fileSizeBytes",
          created_at AS "createdAt"
      `,
      [
        req.familyMember.family_id,
        childId,
        title,
        category,
        documentDate,
        notes,
        fileName,
        fileType,
        req.body.length,
        objectKey,
        req.user.id,
      ],
    );

    res.status(201).json({
      data: mapDocument({
        ...rows[0],
        childName: "",
      }),
      error: null,
    });
  }),
);

documentsRouter.get(
  "/:documentId/download",
  asyncHandler(async (req, res) => {
    const documentId = requireUuid(req.params.documentId, "Document ID");
    const { rows } = await query(
      `
        SELECT
          id,
          object_key,
          file_name,
          file_type
        FROM family_documents
        WHERE id = $1
          AND family_id = $2
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [documentId, req.familyMember.family_id],
    );

    if (!rows[0]) {
      throw notFound("Document not found.");
    }

    res.redirect(createSignedGetUrl({ objectKey: rows[0].object_key }));
  }),
);

documentsRouter.delete(
  "/:documentId",
  requireAtLeastRole("parent"),
  requirePlanAccess("write"),
  asyncHandler(async (req, res) => {
    const documentId = requireUuid(req.params.documentId, "Document ID");

    const { rows } = await query(
      `
        UPDATE family_documents
        SET deleted_at = now()
        WHERE id = $1
          AND family_id = $2
          AND deleted_at IS NULL
        RETURNING id, object_key
      `,
      [documentId, req.familyMember.family_id],
    );

    if (!rows[0]) {
      throw notFound("Document not found.");
    }

    deleteSpacesObject(rows[0].object_key).catch((error) =>
      console.error("Document file delete failed:", error.message),
    );

    res.json({ data: { id: rows[0].id, deleted: true }, error: null });
  }),
);
