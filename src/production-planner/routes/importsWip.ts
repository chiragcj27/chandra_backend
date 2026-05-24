import { Router } from "express";
import multer from "multer";
import { Types } from "mongoose";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { ingestWipFile } from "../services/integrations/gatiWipAdapter";
import { runAlertRulesAsync } from "../services/production/alertEngine";
import { recomputeBaselines } from "../services/production/capacityService";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

router.post(
  "/imports/gati-wip",
  requireAuth,
  requireRole("admin"),
  upload.single("file"),
  async (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "file is required (multipart field 'file')" });

    const lower = (file.originalname ?? "").toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls") && !lower.endsWith(".csv")) {
      return res.status(400).json({ error: "Only .xlsx / .xls / .csv files are accepted" });
    }

    try {
      const uploadedBy =
        req.user?.id && Types.ObjectId.isValid(req.user.id)
          ? new Types.ObjectId(req.user.id)
          : undefined;

      const run = await ingestWipFile({
        buffer: file.buffer,
        fileName: file.originalname ?? "wip.xlsx",
        uploadedBy,
      });

      // Background: refresh capacity baselines from the new movement data,
      // then re-evaluate alerts (which also runs anomaly detection). Both are
      // best-effort and must not block the import response.
      void recomputeBaselines()
        .catch((err) => console.error("[importsWip] recomputeBaselines failed:", err))
        .finally(() => runAlertRulesAsync());

      return res.status(200).json({ run });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Server error";
      return res.status(500).json({ error: message });
    }
  }
);

export default router;
