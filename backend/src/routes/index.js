import { Router } from "express";
import { adminRouter } from "./admin.routes.js";
import { accountRouter } from "./account.routes.js";
import { authRouter } from "./auth.routes.js";
import { careLogsRouter } from "./careLogs.routes.js";
import { childrenRouter } from "./children.routes.js";
import { familiesRouter } from "./families.routes.js";
import { feedbackRouter } from "./feedback.routes.js";
import { healthRouter } from "./health.routes.js";
import { membersRouter } from "./members.routes.js";
import { reportsRouter } from "./reports.routes.js";
import { subscriptionsRouter } from "./subscriptions.routes.js";
import { uploadsRouter } from "./uploads.routes.js";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/account", accountRouter);
apiRouter.use("/admin", adminRouter);
apiRouter.use("/feedback", feedbackRouter);
apiRouter.use("/uploads", uploadsRouter);
apiRouter.use("/families", familiesRouter);
apiRouter.use("/families/:familyId/children", childrenRouter);
apiRouter.use("/families/:familyId/care-logs", careLogsRouter);
apiRouter.use("/families/:familyId/members", membersRouter);
apiRouter.use("/families/:familyId/reports", reportsRouter);
apiRouter.use("/families/:familyId/subscription", subscriptionsRouter);
