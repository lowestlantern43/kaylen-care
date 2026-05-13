import { getFamilyPlanAccess } from "../services/planAccess.js";
import { forbidden } from "../utils/httpError.js";

const actionChecks = {
  addLog: "canAddLogs",
  editLog: "canEditLogs",
  deleteLog: "canDeleteLogs",
  addChild: "canAddChild",
  inviteCarer: "canInviteCarer",
  write: "canEditLogs",
};

export function requirePlanAccess(action) {
  return async (req, res, next) => {
    try {
      const familyId = req.familyMember?.family_id || req.params.familyId;
      const access = await getFamilyPlanAccess(familyId);
      req.familyPlanAccess = access;

      if (req.user?.is_platform_admin) {
        return next();
      }

      const flag = actionChecks[action] || actionChecks.write;
      if (!access[flag]) {
        throw forbidden(
          access.reason === "expired"
            ? "This trial has ended, so the family account is view-only for now."
            : "This family account is view-only for now.",
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
