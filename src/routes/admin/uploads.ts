import crypto from "crypto";
import { Router } from "express";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { env } from "../../config/env";
import { deleteObject, listObjectsByPrefix, presignPutObject, s3KeyToPublicUrl } from "../../services/s3";
import { MediaAsset } from "../../models/MediaAsset";

const router = Router();

/** Permanent admin-uploaded assets (not tmp staging). */
const LIBRARY_PREFIX = "media/admin-library/";

function isLibraryKey(key: string): boolean {
  if (!key.startsWith(LIBRARY_PREFIX)) return false;
  if (key.includes("..") || key.includes("//")) return false;
  return key.length > LIBRARY_PREFIX.length;
}

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
    if (!env.aws) return res.status(503).json({ error: "S3 is not configured" });
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
  "/uploads/featured-collection/presign",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    if (!env.aws) return res.status(503).json({ error: "S3 is not configured" });
    try {
      const body = req.body as { contentType?: string; fileName?: string };
      const contentType = body.contentType?.trim();
      const originalName = body.fileName?.trim() || "featured-collection";

      if (!contentType) return res.status(400).json({ error: "contentType is required" });
      if (!contentType.startsWith("image/")) {
        return res.status(400).json({ error: "Only image uploads are allowed" });
      }

      const safeName = sanitizeFilename(originalName);
      const key = `tmp/featured-collections/${crypto.randomUUID()}-${safeName}`;
      const uploadUrl = await presignPutObject({ key, contentType, expiresInSeconds: 120 });
      return res.status(200).json({ key, uploadUrl });
    } catch (err) {
      console.error("[uploads/featured-collection/presign]", err);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

router.post(
  "/uploads/category/presign",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    if (!env.aws) return res.status(503).json({ error: "S3 is not configured" });
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
    } catch (err) {
      console.error("[uploads/category/presign]", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

router.post(
  "/uploads/subcategory/presign",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    if (!env.aws) return res.status(503).json({ error: "S3 is not configured" });
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
    } catch (err) {
      console.error("[uploads/subcategory/presign]", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

router.post(
  "/uploads/library/presign",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    if (!env.aws) return res.status(503).json({ error: "S3 is not configured" });
    try {
      const body = req.body as { contentType?: string; fileName?: string };
      const contentType = body.contentType?.trim();
      const originalName = body.fileName?.trim() || "image";

      if (!contentType) return res.status(400).json({ error: "contentType is required" });
      if (!contentType.startsWith("image/")) {
        return res.status(400).json({ error: "Only image uploads are allowed" });
      }

      const safeName = sanitizeFilename(originalName);
      const key = `${LIBRARY_PREFIX}${crypto.randomUUID()}-${safeName}`;
      const uploadUrl = await presignPutObject({ key, contentType, expiresInSeconds: 120 });
      const publicUrl = s3KeyToPublicUrl(key);
      return res.status(200).json({ key, uploadUrl, publicUrl });
    } catch (err) {
      console.error("[uploads/library/presign]", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

router.post(
  "/uploads/library/record",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const { name, key, publicUrl, size } = req.body;
      if (!name || !key || !publicUrl) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const asset = await MediaAsset.create({ name, key, publicUrl, size: size || 0 });
      return res.status(200).json({ asset });
    } catch (err) {
      console.error("[uploads/library/record]", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

router.get(
  "/uploads/library",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const continuationToken =
        typeof req.query.continuationToken === "string" ? req.query.continuationToken.trim() : "0";
      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

      const skip = parseInt(continuationToken, 10) || 0;
      const limit = 100;

      const filter: any = {};
      if (search) {
        filter.name = { $regex: search, $options: "i" };
      }

      const assets = await MediaAsset.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await MediaAsset.countDocuments(filter);

      const items = assets.map((a) => ({
        key: a.key,
        publicUrl: a.publicUrl,
        name: a.name,
        size: a.size,
        lastModified: a.createdAt.toISOString(),
      }));

      const nextContinuationToken = skip + items.length < total ? String(skip + items.length) : undefined;

      return res.status(200).json({ items, nextContinuationToken });
    } catch (err) {
      console.error("[uploads/library]", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

router.delete(
  "/uploads/library",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    if (!env.aws) return res.status(503).json({ error: "S3 is not configured" });
    try {
      const key = typeof req.query.key === "string" ? req.query.key.trim() : "";
      if (!key) return res.status(400).json({ error: "key is required" });
      if (!isLibraryKey(key)) return res.status(400).json({ error: "Invalid key" });

      await deleteObject(key);
      await MediaAsset.deleteOne({ key });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[uploads/library DELETE]", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

router.post(
  "/uploads/cancel",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    if (!env.aws) return res.status(503).json({ error: "S3 is not configured" });
    try {
      const body = req.body as { key?: string };
      const key = body.key?.trim();
      if (!key) return res.status(400).json({ error: "key is required" });
      if (!key.startsWith("tmp/")) return res.status(400).json({ error: "Only tmp keys can be cancelled" });

      await deleteObject(key);
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[uploads/cancel]", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

export default router;

