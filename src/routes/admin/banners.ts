import crypto from "crypto";
import { Router } from "express";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { Banner } from "../../models/Banner";
import { copyObject, deleteObject, headObject, s3KeyToPublicUrl } from "../../services/s3";

const router = Router();

function asTrimmedString(x: unknown): string | undefined {
  if (typeof x !== "string") return undefined;
  const t = x.trim();
  return t.length ? t : undefined;
}

router.get("/banners", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const banners = await Banner.find().sort({ displayOrder: 1, createdAt: -1 });
    return res.status(200).json({ banners });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/banners", requireAuth, requireRole("admin"), async (req, res) => {
  const body = req.body as {
    title?: string;
    linkUrl?: string;
    displayOrder?: number;
    isActive?: boolean;
    tmpKey?: string;
  };

  const title = asTrimmedString(body.title);
  const linkUrl = asTrimmedString(body.linkUrl);
  const tmpKey = asTrimmedString(body.tmpKey);
  const displayOrder = Number.isFinite(body.displayOrder) ? Number(body.displayOrder) : 0;
  const isActive = typeof body.isActive === "boolean" ? body.isActive : true;

  if (!title) return res.status(400).json({ error: "title is required" });
  if (!tmpKey) return res.status(400).json({ error: "tmpKey is required" });
  if (!tmpKey.startsWith("tmp/")) return res.status(400).json({ error: "tmpKey must start with tmp/" });

  let finalKey: string | null = null;

  try {
    const exists = await headObject(tmpKey);
    if (!exists) return res.status(400).json({ error: "Uploaded file not found on S3" });

    const fileSuffix = tmpKey.split("/").pop() ?? crypto.randomUUID();
    finalKey = `banners/${crypto.randomUUID()}-${fileSuffix}`;

    await copyObject({ fromKey: tmpKey, toKey: finalKey });

    const imageUrl = s3KeyToPublicUrl(finalKey);
    const created = await Banner.create({
      title,
      linkUrl,
      displayOrder,
      isActive,
      imageKey: finalKey,
      imageUrl,
    });

    await deleteObject(tmpKey);
    return res.status(201).json({ banner: created });
  } catch (err) {
    try {
      if (finalKey) await deleteObject(finalKey);
    } catch {
      // best-effort cleanup
    }
    try {
      await deleteObject(tmpKey);
    } catch {
      // best-effort cleanup
    }
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/banners/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const body = req.body as {
    title?: string;
    linkUrl?: string;
    displayOrder?: number;
    isActive?: boolean;
    tmpKey?: string;
  };

  const id = req.params.id;
  const title = asTrimmedString(body.title);
  const linkUrl = typeof body.linkUrl === "string" ? body.linkUrl.trim() : undefined;
  const tmpKey = asTrimmedString(body.tmpKey);
  const displayOrder = body.displayOrder;
  const isActive = body.isActive;

  const banner = await Banner.findById(id);
  if (!banner) return res.status(404).json({ error: "Not found" });

  const oldKey = banner.imageKey;
  let newKey: string | null = null;

  try {
    if (typeof title === "string") banner.title = title;
    if (typeof linkUrl === "string") banner.linkUrl = linkUrl.length ? linkUrl : undefined;
    if (Number.isFinite(displayOrder)) banner.displayOrder = Number(displayOrder);
    if (typeof isActive === "boolean") banner.isActive = isActive;

    if (tmpKey) {
      if (!tmpKey.startsWith("tmp/")) return res.status(400).json({ error: "tmpKey must start with tmp/" });
      const exists = await headObject(tmpKey);
      if (!exists) return res.status(400).json({ error: "Uploaded file not found on S3" });

      const fileSuffix = tmpKey.split("/").pop() ?? crypto.randomUUID();
      newKey = `banners/${crypto.randomUUID()}-${fileSuffix}`;
      await copyObject({ fromKey: tmpKey, toKey: newKey });

      banner.imageKey = newKey;
      banner.imageUrl = s3KeyToPublicUrl(newKey);

      await deleteObject(tmpKey);
    }

    await banner.save();

    if (newKey) {
      try {
        await deleteObject(oldKey);
      } catch {
        // best-effort cleanup
      }
    }

    return res.status(200).json({ banner });
  } catch {
    try {
      if (newKey) await deleteObject(newKey);
    } catch {
      // best-effort cleanup
    }
    try {
      if (tmpKey) await deleteObject(tmpKey);
    } catch {
      // best-effort cleanup
    }
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/banners/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = req.params.id;
    const banner = await Banner.findById(id);
    if (!banner) return res.status(404).json({ error: "Not found" });

    await Banner.deleteOne({ _id: id });

    try {
      await deleteObject(banner.imageKey);
    } catch {
      // best-effort cleanup
    }

    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;

