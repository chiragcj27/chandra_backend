import { Router } from "express";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import {
  buildRequirementsTable,
  getShortages,
} from "../services/inventory/requirementsService";

const router = Router();

/**
 * GET /inventory/requirements — full requirements vs stock table.
 * Returns one row per Diamond SKU with onHand / allocated / available /
 * required / delta and a `status` of ok | low | shortage | critical.
 */
router.get(
  "/inventory/requirements",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const all = await buildRequirementsTable();
      const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
      const items = statusFilter ? all.filter((r) => r.status === statusFilter) : all;
      return res.status(200).json({ items, total: items.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Server error";
      return res.status(500).json({ error: message });
    }
  }
);

/** GET /inventory/shortages — only rows where delta < 0 (shortage or critical). */
router.get("/inventory/shortages", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const items = await getShortages();
    return res.status(200).json({ items, total: items.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return res.status(500).json({ error: message });
  }
});

export default router;
