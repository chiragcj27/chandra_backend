import crypto from "crypto";
import { Router } from "express";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { deleteObject, presignPutObject } from "../../services/s3";

const router = Router();

function sanitizeFilename(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

router.post(
  "/uploads/banner/presign",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const body = req.body as { contentType?: string; fileName?: string };
      const contentType = body.contentType?.trim();
      const originalName = body.fileName?.trim() || "banner";

      if (!contentType) return res.status(400).json({ error: "contentType is required" });
      if (!contentType.startsWith("image/")) {
        return res.status(400).json({ error: "Only image uploads are allowed" });
      }

      const safeName = sanitizeFilename(originalName);
      const key = `tmp/banners/${crypto.randomUUID()}-${safeName}`;
      const uploadUrl = await presignPutObject({ key, contentType, expiresInSeconds: 120 });
      return res.status(200).json({ key, uploadUrl });
    } catch (err) {
      console.error("[uploads/banner/presign]", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

router.post(
  "/uploads/category/presign",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const body = req.body as { contentType?: string; fileName?: string };
      const contentType = body.contentType?.trim();
      const originalName = body.fileName?.trim() || "category";

      if (!contentType) return res.status(400).json({ error: "contentType is required" });
      if (!contentType.startsWith("image/")) {
        return res.status(400).json({ error: "Only image uploads are allowed" });
      }

      const safeName = sanitizeFilename(originalName);
      const key = `tmp/categories/${crypto.randomUUID()}-${safeName}`;
      const uploadUrl = await presignPutObject({ key, contentType, expiresInSeconds: 120 });
      return res.status(200).json({ key, uploadUrl });
    } catch {
      return res.status(500).json({ error: "Server error" });
    }
  }
);

router.post(
  "/uploads/subcategory/presign",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const body = req.body as { contentType?: string; fileName?: string };
      const contentType = body.contentType?.trim();
      const originalName = body.fileName?.trim() || "subcategory";

      if (!contentType) return res.status(400).json({ error: "contentType is required" });
      if (!contentType.startsWith("image/")) {
        return res.status(400).json({ error: "Only image uploads are allowed" });
      }

      const safeName = sanitizeFilename(originalName);
      const key = `tmp/subcategories/${crypto.randomUUID()}-${safeName}`;
      const uploadUrl = await presignPutObject({ key, contentType, expiresInSeconds: 120 });
      return res.status(200).json({ key, uploadUrl });
    } catch {
      return res.status(500).json({ error: "Server error" });
    }
  }
);

router.post(
  "/uploads/cancel",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const body = req.body as { key?: string };
      const key = body.key?.trim();
      if (!key) return res.status(400).json({ error: "key is required" });
      if (!key.startsWith("tmp/")) return res.status(400).json({ error: "Only tmp keys can be cancelled" });

      await deleteObject(key);
      return res.status(200).json({ ok: true });
    } catch {
      return res.status(500).json({ error: "Server error" });
    }
  }
);

export default router;

