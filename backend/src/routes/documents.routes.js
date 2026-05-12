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
import { config } from "../config.js";

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

async function ensureDocumentVaultBillingSchema() {
  await query(
    "ALTER TABLE families ADD COLUMN IF NOT EXISTS document_vault_override jsonb",
  );
  await query(
    `
      INSERT INTO platform_settings (key, value)
      VALUES (
        'document_vault',
        $1::jsonb
      )
      ON CONFLICT (key) DO NOTHING
    `,
    [
      JSON.stringify({
        enabled: true,
        tiers: [
          {
            id: "storage-50gb",
            label: "50GB Secure Document Storage",
            monthlyPriceGbp: 2,
            includedStorageGb: 50,
            stripePriceId: config.stripeDocuments50GbPriceId,
          },
          {
            id: "storage-100gb",
            label: "100GB Secure Document Storage",
            monthlyPriceGbp: 3,
            includedStorageGb: 100,
            stripePriceId: config.stripeDocuments100GbPriceId,
          },
        ],
        notes: "Secure Document Storage add-on pricing.",
      }),
    ],
  );
}

function normaliseDocumentVaultTiers(tiers = []) {
  const cleanTiers = Array.isArray(tiers)
    ? tiers
        .map((tier, index) => {
          const includedStorageGb = Number(tier?.includedStorageGb);
          const monthlyPriceGbp = Number(tier?.monthlyPriceGbp);
          return {
            id:
              typeof tier?.id === "string" && tier.id.trim()
                ? tier.id.trim()
                : `storage-tier-${index + 1}`,
            label:
              typeof tier?.label === "string" && tier.label.trim()
                ? tier.label.trim()
                : `${includedStorageGb || 100}GB storage`,
            monthlyPriceGbp: Number.isFinite(monthlyPriceGbp)
              ? Math.max(0, monthlyPriceGbp)
              : 2,
            includedStorageGb: Number.isFinite(includedStorageGb)
              ? Math.max(0, includedStorageGb)
              : 100,
            stripePriceId:
              typeof tier?.stripePriceId === "string"
                ? tier.stripePriceId.trim()
                : "",
          };
        })
        .filter((tier) => tier.includedStorageGb > 0 || tier.monthlyPriceGbp > 0)
    : [];

  return cleanTiers.length
    ? cleanTiers
    : [
        {
          id: "storage-50gb",
          label: "50GB Secure Document Storage",
          monthlyPriceGbp: 2,
          includedStorageGb: 50,
          stripePriceId: config.stripeDocuments50GbPriceId,
        },
        {
          id: "storage-100gb",
          label: "100GB Secure Document Storage",
          monthlyPriceGbp: 3,
          includedStorageGb: 100,
          stripePriceId: config.stripeDocuments100GbPriceId,
        },
      ];
}

function normaliseDocumentVaultOverride(value = {}) {
  const status = ["default", "included", "paid", "disabled"].includes(
    value.status,
  )
    ? value.status
    : "default";

  return {
    status,
    tierId:
      typeof value.tierId === "string" && value.tierId.trim()
        ? value.tierId.trim()
        : "",
    monthlyPriceGbp:
      value.monthlyPriceGbp === null || value.monthlyPriceGbp === ""
        ? null
        : Number.isFinite(Number(value.monthlyPriceGbp))
          ? Number(value.monthlyPriceGbp)
          : null,
    includedStorageGb:
      value.includedStorageGb === null || value.includedStorageGb === ""
        ? null
        : Number.isFinite(Number(value.includedStorageGb))
          ? Number(value.includedStorageGb)
          : null,
  };
}

async function getDocumentVaultAccess(familyId) {
  await ensureDocumentVaultBillingSchema();

  const [settingsResult, familyResult, usageResult] = await Promise.all([
    query(
      `
        SELECT value
        FROM platform_settings
        WHERE key = 'document_vault'
        LIMIT 1
      `,
    ),
    query(
      `
        SELECT document_vault_override AS "documentVaultOverride"
        FROM families
        WHERE id = $1
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [familyId],
    ),
    query(
      `
        SELECT COALESCE(sum(file_size_bytes), 0)::bigint AS "totalBytes"
        FROM family_documents
        WHERE family_id = $1
          AND deleted_at IS NULL
      `,
      [familyId],
    ),
  ]);

  const settings = settingsResult.rows[0]?.value || {};
  const tiers = normaliseDocumentVaultTiers(settings.tiers);
  const override = normaliseDocumentVaultOverride(
    familyResult.rows[0]?.documentVaultOverride || {},
  );
  const selectedTier =
    tiers.find((tier) => tier.id === override.tierId) || tiers[0];
  const includedStorageGb =
    override.includedStorageGb !== null
      ? override.includedStorageGb
      : selectedTier.includedStorageGb;

  return {
    enabled: settings.enabled !== false && override.status !== "disabled",
    hasWriteAccess: ["paid", "included"].includes(override.status),
    status: override.status,
    includedStorageBytes: Math.max(0, includedStorageGb) * 1024 ** 3,
    currentBytes: Number(usageResult.rows[0]?.totalBytes || 0),
    tier: selectedTier,
  };
}

async function assertDocumentVaultCanUpload({ familyId, incomingBytes }) {
  const access = await getDocumentVaultAccess(familyId);

  if (!access.enabled) {
    throw badRequest(
      "Document Vault uploads are disabled for this family. Existing documents remain available.",
    );
  }

  if (!access.hasWriteAccess) {
    throw badRequest(
      "Document Vault is a paid add-on. Choose a storage plan before uploading new documents.",
    );
  }

  if (
    access.includedStorageBytes > 0 &&
    access.currentBytes + incomingBytes > access.includedStorageBytes
  ) {
    throw badRequest(
      "Document Vault storage limit reached. Upgrade the storage plan or remove older documents before uploading.",
    );
  }

  return access;
}

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

    await assertDocumentVaultCanUpload({
      familyId: req.familyMember.family_id,
      incomingBytes: req.body.length,
    });

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
