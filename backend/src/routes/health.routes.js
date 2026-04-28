import { Router } from "express";
import { query } from "../db/pool.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const healthRouter = Router();

healthRouter.get("/", (req, res) => {
  res.json({
    data: {
      ok: true,
      service: "familytrack-backend",
      checkedAt: new Date().toISOString(),
    },
    error: null,
  });
});

healthRouter.get(
  "/db",
  asyncHandler(async (req, res) => {
    await query("SELECT 1");
    res.json({ data: { ok: true, database: "connected" }, error: null });
  }),
);
