import { Router } from "express";
import multer from "multer";
import { Types } from "mongoose";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { ingestOrdersFile } from "../services/integrations/gatiOrdersAdapter";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB cap
});

router.post(
  "/imports/gati-orders",
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

      const run = await ingestOrdersFile({
        buffer: file.buffer,
        fileName: file.originalname ?? "orders.xlsx",
        uploadedBy,
      });
      return res.status(200).json({ run });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Server error";
      return res.status(500).json({ error: message });
    }
  }
);

export default router;
