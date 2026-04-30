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

      const flag = actionChecks[action] || actionChecks.write;
      if (!access[flag]) {
        throw forbidden(
          access.reason === "expired"
            ? "This trial has ended. The family account is now view-only."
            : "This family account is currently view-only.",
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
