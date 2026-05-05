import { Router } from "express";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAtLeastRole, requireFamilyMember } from "../middleware/familyAccess.js";
import { requirePlanAccess } from "../middleware/planAccess.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, notFound } from "../utils/httpError.js";
import {
  optionalDate,
  optionalString,
  optionalTime,
  requireEnum,
  requireString,
  requireUuid,
} from "../validators/simple.js";

export const childrenRouter = Router({ mergeParams: true });

childrenRouter.use(requireAuth, requireFamilyMember);

const profileFields = [
  "diagnosisNeeds",
  "communicationStyle",
  "keyNeeds",
  "currentMedications",
  "allergies",
  "emergencyNotes",
  "likes",
  "dislikes",
  "triggers",
  "calmingStrategies",
  "eatingPreferences",
  "sleepPreferences",
  "toiletingNotes",
  "sensoryNeeds",
  "schoolEhcpNotes",
  "medicalNotes",
];

const profileColumnMap = {
  diagnosisNeeds: "diagnosis_needs",
  communicationStyle: "communication_style",
  keyNeeds: "key_needs",
  currentMedications: "current_medications",
  allergies: "allergies",
  emergencyNotes: "emergency_notes",
  likes: "likes",
  dislikes: "dislikes",
  triggers: "triggers",
  calmingStrategies: "calming_strategies",
  eatingPreferences: "eating_preferences",
  sleepPreferences: "sleep_preferences",
  toiletingNotes: "toileting_notes",
  sensoryNeeds: "sensory_needs",
  schoolEhcpNotes: "school_ehcp_notes",
  medicalNotes: "medical_notes",
};

async function assertChildInFamily(childId, familyId) {
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
    throw notFound("Child not found.");
  }
}

childrenRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `
        WITH canonical_children AS (
          SELECT DISTINCT ON (
            lower(trim(first_name)),
            lower(trim(COALESCE(last_name, '')))
          )
            id,
            first_name,
            last_name,
            date_of_birth,
            nhs_number,
            avatar_url,
            notes,
            created_at,
            updated_at,
            count(*) OVER (
              PARTITION BY
                lower(trim(first_name)),
                lower(trim(COALESCE(last_name, '')))
            ) AS duplicate_count
          FROM children
          WHERE family_id = $1 AND deleted_at IS NULL
          ORDER BY
            lower(trim(first_name)),
            lower(trim(COALESCE(last_name, ''))),
            created_at ASC,
            id ASC
        )
        SELECT
          id,
          first_name AS "firstName",
          last_name AS "lastName",
          date_of_birth::text AS "dateOfBirth",
          nhs_number AS "nhsNumber",
          avatar_url AS "avatarUrl",
          notes,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          duplicate_count::int AS "duplicateCount"
        FROM canonical_children
        ORDER BY first_name ASC, created_at ASC
      `,
      [req.familyMember.family_id],
    );

    res.json({ data: rows, error: null });
  }),
);

childrenRouter.post(
  "/",
  requireAtLeastRole("parent"),
  requirePlanAccess("addChild"),
  asyncHandler(async (req, res) => {
    const firstName = requireString(req.body, "firstName", "First name");
    const lastName = optionalString(req.body, "lastName");
    const dateOfBirth = optionalDate(req.body, "dateOfBirth");
    const nhsNumber = optionalString(req.body, "nhsNumber");
    const avatarUrl = optionalString(req.body, "avatarUrl");
    const notes = optionalString(req.body, "notes");

    const duplicate = await query(
      `
        SELECT id
        FROM children
        WHERE family_id = $1
          AND deleted_at IS NULL
          AND lower(trim(first_name)) = lower(trim($2))
          AND lower(trim(COALESCE(last_name, ''))) = lower(trim(COALESCE($3, '')))
        LIMIT 1
      `,
      [req.familyMember.family_id, firstName, lastName],
    );

    if (duplicate.rows[0]) {
      throw badRequest("That child already exists in this family.");
    }

    const { rows } = await query(
      `
        INSERT INTO children (
          family_id,
          first_name,
          last_name,
          date_of_birth,
          nhs_number,
          avatar_url,
          notes,
          created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING
          id,
          first_name AS "firstName",
          last_name AS "lastName",
          date_of_birth::text AS "dateOfBirth",
          nhs_number AS "nhsNumber",
          avatar_url AS "avatarUrl",
          notes,
          created_at AS "createdAt"
      `,
      [
        req.familyMember.family_id,
        firstName,
        lastName,
        dateOfBirth,
        nhsNumber,
        avatarUrl,
        notes,
        req.user.id,
      ],
    );

    res.status(201).json({ data: rows[0], error: null });
  }),
);

childrenRouter.patch(
  "/:childId",
  requireAtLeastRole("parent"),
  requirePlanAccess("write"),
  asyncHandler(async (req, res) => {
    const childId = requireUuid(req.params.childId, "Child ID");
    const firstName = requireString(req.body, "firstName", "First name");
    const lastName = optionalString(req.body, "lastName");
    const dateOfBirth = optionalDate(req.body, "dateOfBirth");
    const nhsNumber = optionalString(req.body, "nhsNumber");
    const avatarUrl = optionalString(req.body, "avatarUrl");
    const notes = optionalString(req.body, "notes");

    const { rows } = await query(
      `
        UPDATE children
        SET first_name = $1,
            last_name = $2,
            date_of_birth = $3,
            nhs_number = $4,
            avatar_url = $5,
            notes = $6
        WHERE id = $7
          AND family_id = $8
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
      [
        firstName,
        lastName,
        dateOfBirth,
        nhsNumber,
        avatarUrl,
        notes,
        childId,
        req.familyMember.family_id,
      ],
    );

    if (!rows[0]) {
      throw notFound("Child not found.");
    }

    res.json({ data: rows[0], error: null });
  }),
);

childrenRouter.get(
  "/:childId/profile",
  asyncHandler(async (req, res) => {
    const childId = requireUuid(req.params.childId, "Child ID");
    await assertChildInFamily(childId, req.familyMember.family_id);

    const { rows } = await query(
      `
        SELECT
          child_id AS "childId",
          diagnosis_needs AS "diagnosisNeeds",
          communication_style AS "communicationStyle",
          key_needs AS "keyNeeds",
          current_medications AS "currentMedications",
          allergies,
          emergency_notes AS "emergencyNotes",
          likes,
          dislikes,
          triggers,
          calming_strategies AS "calmingStrategies",
          eating_preferences AS "eatingPreferences",
          sleep_preferences AS "sleepPreferences",
          toileting_notes AS "toiletingNotes",
          sensory_needs AS "sensoryNeeds",
          school_ehcp_notes AS "schoolEhcpNotes",
          medical_notes AS "medicalNotes",
          updated_at AS "updatedAt"
        FROM child_profiles
        WHERE family_id = $1
          AND child_id = $2
        LIMIT 1
      `,
      [req.familyMember.family_id, childId],
    );

    res.json({ data: rows[0] || { childId }, error: null });
  }),
);

childrenRouter.put(
  "/:childId/profile",
  requireAtLeastRole("parent"),
  requirePlanAccess("write"),
  asyncHandler(async (req, res) => {
    const childId = requireUuid(req.params.childId, "Child ID");
    await assertChildInFamily(childId, req.familyMember.family_id);

    const values = profileFields.map((field) => optionalString(req.body, field));
    const insertColumns = profileFields.map((field) => profileColumnMap[field]);
    const insertPlaceholders = values.map((_, index) => `$${index + 4}`);
    const updateColumns = profileFields.map(
      (field) => `${profileColumnMap[field]} = EXCLUDED.${profileColumnMap[field]}`,
    );

    const { rows } = await query(
      `
        INSERT INTO child_profiles (
          child_id,
          family_id,
          updated_by_user_id,
          ${insertColumns.join(", ")}
        )
        VALUES ($1, $2, $3, ${insertPlaceholders.join(", ")})
        ON CONFLICT (child_id)
        DO UPDATE SET
          ${updateColumns.join(", ")},
          updated_by_user_id = EXCLUDED.updated_by_user_id
        RETURNING
          child_id AS "childId",
          diagnosis_needs AS "diagnosisNeeds",
          communication_style AS "communicationStyle",
          key_needs AS "keyNeeds",
          current_medications AS "currentMedications",
          allergies,
          emergency_notes AS "emergencyNotes",
          likes,
          dislikes,
          triggers,
          calming_strategies AS "calmingStrategies",
          eating_preferences AS "eatingPreferences",
          sleep_preferences AS "sleepPreferences",
          toileting_notes AS "toiletingNotes",
          sensory_needs AS "sensoryNeeds",
          school_ehcp_notes AS "schoolEhcpNotes",
          medical_notes AS "medicalNotes",
          updated_at AS "updatedAt"
      `,
      [childId, req.familyMember.family_id, req.user.id, ...values],
    );

    res.json({ data: rows[0], error: null });
  }),
);

childrenRouter.get(
  "/:childId/important-events",
  asyncHandler(async (req, res) => {
    const childId = requireUuid(req.params.childId, "Child ID");
    await assertChildInFamily(childId, req.familyMember.family_id);

    const { rows } = await query(
      `
        SELECT
          id,
          event_date::text AS "eventDate",
          to_char(event_time, 'HH24:MI') AS "eventTime",
          event_type AS "eventType",
          notes,
          action_taken AS "actionTaken",
          outcome,
          created_at AS "createdAt"
        FROM important_events
        WHERE family_id = $1
          AND child_id = $2
          AND deleted_at IS NULL
        ORDER BY event_date DESC, event_time DESC NULLS LAST, created_at DESC
        LIMIT 100
      `,
      [req.familyMember.family_id, childId],
    );

    res.json({ data: rows, error: null });
  }),
);

childrenRouter.post(
  "/:childId/important-events",
  requireAtLeastRole("carer"),
  requirePlanAccess("addLog"),
  asyncHandler(async (req, res) => {
    const childId = requireUuid(req.params.childId, "Child ID");
    await assertChildInFamily(childId, req.familyMember.family_id);

    const eventDate = optionalDate(req.body, "eventDate");
    if (!eventDate) {
      throw badRequest("Event date is required.");
    }
    const eventTime = optionalTime(req.body, "eventTime");
    const eventType = requireEnum(req.body, "eventType", [
      "seizure",
      "injury",
      "meltdown",
      "hospital_visit",
      "medication_reaction",
      "illness",
      "other",
    ]);
    const notes = optionalString(req.body, "notes");
    const actionTaken = optionalString(req.body, "actionTaken");
    const outcome = optionalString(req.body, "outcome");

    const { rows } = await query(
      `
        INSERT INTO important_events (
          family_id,
          child_id,
          event_date,
          event_time,
          event_type,
          notes,
          action_taken,
          outcome,
          created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING
          id,
          event_date::text AS "eventDate",
          to_char(event_time, 'HH24:MI') AS "eventTime",
          event_type AS "eventType",
          notes,
          action_taken AS "actionTaken",
          outcome,
          created_at AS "createdAt"
      `,
      [
        req.familyMember.family_id,
        childId,
        eventDate,
        eventTime,
        eventType,
        notes,
        actionTaken,
        outcome,
        req.user.id,
      ],
    );

    res.status(201).json({ data: rows[0], error: null });
  }),
);

childrenRouter.delete(
  "/:childId/important-events/:eventId",
  requireAtLeastRole("parent"),
  requirePlanAccess("deleteLog"),
  asyncHandler(async (req, res) => {
    const childId = requireUuid(req.params.childId, "Child ID");
    const eventId = requireUuid(req.params.eventId, "Important event ID");

    const { rows } = await query(
      `
        UPDATE important_events
        SET deleted_at = now()
        WHERE id = $1
          AND child_id = $2
          AND family_id = $3
          AND deleted_at IS NULL
        RETURNING id
      `,
      [eventId, childId, req.familyMember.family_id],
    );

    if (!rows[0]) {
      throw notFound("Important event not found.");
    }

    res.json({ data: { id: rows[0].id, deleted: true }, error: null });
  }),
);

childrenRouter.get(
  "/:childId/care-options",
  asyncHandler(async (req, res) => {
    const childId = requireUuid(req.params.childId, "Child ID");

    const { rows } = await query(
      `
        SELECT
          co.id,
          co.category,
          co.label,
          co.default_value AS "defaultValue",
          co.created_at AS "createdAt"
        FROM child_care_options co
        INNER JOIN children c ON c.id = co.child_id
        WHERE co.family_id = $1
          AND co.child_id = $2
          AND co.deleted_at IS NULL
          AND c.deleted_at IS NULL
        ORDER BY co.category ASC, co.label ASC
      `,
      [req.familyMember.family_id, childId],
    );

    res.json({ data: rows, error: null });
  }),
);

childrenRouter.post(
  "/:childId/care-options",
  requireAtLeastRole("parent"),
  requirePlanAccess("write"),
  asyncHandler(async (req, res) => {
    const childId = requireUuid(req.params.childId, "Child ID");
    const category = requireEnum(req.body, "category", [
      "food",
      "drink",
      "medication",
      "given_by",
      "location",
    ]);
    const label = requireString(req.body, "label", "Name");
    const defaultValue = optionalString(req.body, "defaultValue");

    const child = await query(
      `
        SELECT id
        FROM children
        WHERE id = $1
          AND family_id = $2
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [childId, req.familyMember.family_id],
    );

    if (!child.rows[0]) {
      throw notFound("Child not found.");
    }

    const { rows } = await query(
      `
        INSERT INTO child_care_options (
          family_id,
          child_id,
          category,
          label,
          default_value,
          created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (family_id, child_id, category, (lower(label)))
          WHERE deleted_at IS NULL
        DO UPDATE SET
          default_value = EXCLUDED.default_value,
          deleted_at = NULL
        RETURNING
          id,
          category,
          label,
          default_value AS "defaultValue",
          created_at AS "createdAt"
      `,
      [
        req.familyMember.family_id,
        childId,
        category,
        label,
        defaultValue,
        req.user.id,
      ],
    );

    res.status(201).json({ data: rows[0], error: null });
  }),
);

childrenRouter.delete(
  "/:childId/care-options/:optionId",
  requireAtLeastRole("parent"),
  requirePlanAccess("write"),
  asyncHandler(async (req, res) => {
    const childId = requireUuid(req.params.childId, "Child ID");
    const optionId = requireUuid(req.params.optionId, "Option ID");

    const { rows } = await query(
      `
        UPDATE child_care_options
        SET deleted_at = now()
        WHERE id = $1
          AND child_id = $2
          AND family_id = $3
          AND deleted_at IS NULL
        RETURNING id
      `,
      [optionId, childId, req.familyMember.family_id],
    );

    if (!rows[0]) {
      throw notFound("Care option not found.");
    }

    res.json({ data: { id: rows[0].id, deleted: true }, error: null });
  }),
);

childrenRouter.delete(
  "/:childId",
  requireAtLeastRole("parent"),
  requirePlanAccess("write"),
  asyncHandler(async (req, res) => {
    const childId = requireUuid(req.params.childId, "Child ID");

    const { rows } = await query(
      `
        UPDATE children
        SET deleted_at = now()
        WHERE id = $1
          AND family_id = $2
          AND deleted_at IS NULL
        RETURNING id
      `,
      [childId, req.familyMember.family_id],
    );

    if (!rows[0]) {
      throw notFound("Child not found.");
    }

    res.json({ data: { id: rows[0].id, deleted: true }, error: null });
  }),
);
