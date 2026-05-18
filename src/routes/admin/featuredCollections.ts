import crypto from "crypto";
import { Router } from "express";
import mongoose from "mongoose";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { Category } from "../../models/Category";
import {
  FeaturedCollection,
  type FeaturedCollectionItemType,
} from "../../models/FeaturedCollection";
import { Product } from "../../models/Product";
import { Subcategory } from "../../models/Subcategory";
import { copyObject, deleteObject, headObject, s3KeyToPublicUrl } from "../../services/s3";
import { resolveFeaturedCollectionItems } from "../../services/featuredCollectionItems";

const router = Router();

function asTrimmedString(x: unknown): string | undefined {
  if (typeof x !== "string") return undefined;
  const t = x.trim();
  return t.length ? t : undefined;
}

router.get("/featured-collections", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const collections = await FeaturedCollection.find().sort({ displayOrder: 1, createdAt: -1 });
    return res.status(200).json({ featuredCollections: collections });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

/** Preview products for admin picker (category → profile → subcategory). */
router.get(
  "/featured-collections/picker/products",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const categoryId = asTrimmedString(req.query.categoryId);
      const subcategoryProfileId = asTrimmedString(req.query.subcategoryProfileId);
      const subcategoryId = asTrimmedString(req.query.subcategoryId);
      const query: Record<string, unknown> = {};

      if (categoryId) {
        if (!mongoose.Types.ObjectId.isValid(categoryId)) {
          return res.status(400).json({ error: "Invalid categoryId" });
        }
        query.categoryId = categoryId;
      }
      if (subcategoryProfileId) {
        if (!mongoose.Types.ObjectId.isValid(subcategoryProfileId)) {
          return res.status(400).json({ error: "Invalid subcategoryProfileId" });
        }
        query.subcategoryProfileId = subcategoryProfileId;
      }
      if (subcategoryId) {
        if (!mongoose.Types.ObjectId.isValid(subcategoryId)) {
          return res.status(400).json({ error: "Invalid subcategoryId" });
        }
        query.subcategoryId = subcategoryId;
      }

      const products = await Product.find(query)
        .sort({ displayOrder: 1, createdAt: -1 })
        .select("_id styleNo name displayImage secondaryImage images subcategoryId categoryId isActive");

      const categories = await Category.find().select("_id name");
      const categoryNameById = new Map(categories.map((c) => [String(c._id), c.name]));

      const payload = products.map((p) => ({
        _id: p._id,
        styleNo: p.styleNo,
        name: p.name ?? "",
        isActive: p.isActive,
        categoryName: categoryNameById.get(String(p.categoryId)) ?? "",
        imageUrl: p.displayImage || p.secondaryImage || (p.images?.[0] ?? ""),
        subcategoryId: p.subcategoryId,
      }));

      return res.status(200).json({ products: payload });
    } catch {
      return res.status(500).json({ error: "Server error" });
    }
  },
);

router.get("/featured-collections/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const collection = await FeaturedCollection.findById(req.params.id);
    if (!collection) return res.status(404).json({ error: "Not found" });

    const items = await resolveFeaturedCollectionItems(collection);
    return res.status(200).json({
      collection: {
        _id: collection._id,
        name: collection.name,
        description: collection.description ?? "",
        bannerImageUrl: collection.bannerImageUrl,
        displayOrder: collection.displayOrder,
        isActive: collection.isActive,
        items,
        rawItems: collection.items,
      },
    });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/featured-collections", requireAuth, requireRole("admin"), async (req, res) => {
  const body = req.body as {
    name?: string;
    description?: string;
    displayOrder?: number;
    isActive?: boolean;
    tmpKey?: string;
  };

  const name = asTrimmedString(body.name);
  const description = asTrimmedString(body.description);
  const tmpKey = asTrimmedString(body.tmpKey);
  const displayOrder = Number.isFinite(body.displayOrder) ? Number(body.displayOrder) : 0;
  const isActive = typeof body.isActive === "boolean" ? body.isActive : true;

  if (!name) return res.status(400).json({ error: "name is required" });
  if (!tmpKey) return res.status(400).json({ error: "tmpKey is required" });
  if (!tmpKey.startsWith("tmp/")) return res.status(400).json({ error: "tmpKey must start with tmp/" });

  let finalKey: string | null = null;

  try {
    const exists = await headObject(tmpKey);
    if (!exists) return res.status(400).json({ error: "Uploaded file not found on S3" });

    const fileSuffix = tmpKey.split("/").pop() ?? crypto.randomUUID();
    finalKey = `featured-collections/${crypto.randomUUID()}-${fileSuffix}`;
    await copyObject({ fromKey: tmpKey, toKey: finalKey });

    const created = await FeaturedCollection.create({
      name,
      description,
      displayOrder,
      isActive,
      bannerImageKey: finalKey,
      bannerImageUrl: s3KeyToPublicUrl(finalKey),
      items: [],
    });

    await deleteObject(tmpKey);
    return res.status(201).json({ featuredCollection: created });
  } catch {
    try {
      if (finalKey) await deleteObject(finalKey);
    } catch {
      // best-effort
    }
    try {
      await deleteObject(tmpKey);
    } catch {
      // best-effort
    }
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/featured-collections/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const body = req.body as {
    name?: string;
    description?: string;
    displayOrder?: number;
    isActive?: boolean;
    tmpKey?: string;
  };

  const collection = await FeaturedCollection.findById(req.params.id);
  if (!collection) return res.status(404).json({ error: "Not found" });

  const name = asTrimmedString(body.name);
  const description = typeof body.description === "string" ? body.description.trim() : undefined;
  const tmpKey = asTrimmedString(body.tmpKey);
  const displayOrder = body.displayOrder;
  const isActive = body.isActive;

  const oldKey = collection.bannerImageKey;
  let newKey: string | null = null;

  try {
    if (typeof name === "string") collection.name = name;
    if (typeof description === "string") collection.description = description.length ? description : undefined;
    if (Number.isFinite(displayOrder)) collection.displayOrder = Number(displayOrder);
    if (typeof isActive === "boolean") collection.isActive = isActive;

    if (tmpKey) {
      if (!tmpKey.startsWith("tmp/")) return res.status(400).json({ error: "tmpKey must start with tmp/" });
      const exists = await headObject(tmpKey);
      if (!exists) return res.status(400).json({ error: "Uploaded file not found on S3" });

      const fileSuffix = tmpKey.split("/").pop() ?? crypto.randomUUID();
      newKey = `featured-collections/${crypto.randomUUID()}-${fileSuffix}`;
      await copyObject({ fromKey: tmpKey, toKey: newKey });
      collection.bannerImageKey = newKey;
      collection.bannerImageUrl = s3KeyToPublicUrl(newKey);
      await deleteObject(tmpKey);
    }

    await collection.save();

    if (newKey && oldKey && oldKey !== newKey) {
      try {
        await deleteObject(oldKey);
      } catch {
        // best-effort
      }
    }

    return res.status(200).json({ featuredCollection: collection });
  } catch {
    try {
      if (newKey) await deleteObject(newKey);
    } catch {
      // best-effort
    }
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/featured-collections/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const collection = await FeaturedCollection.findById(req.params.id);
  if (!collection) return res.status(404).json({ error: "Not found" });

  try {
    const key = collection.bannerImageKey;
    await collection.deleteOne();
    if (key) {
      try {
        await deleteObject(key);
      } catch {
        // best-effort
      }
    }
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/featured-collections/:id/items", requireAuth, requireRole("admin"), async (req, res) => {
  const body = req.body as {
    type?: FeaturedCollectionItemType;
    subcategoryId?: string;
    productId?: string;
    displayOrder?: number;
  };

  const type = body.type;
  const subcategoryId = asTrimmedString(body.subcategoryId);
  const productId = asTrimmedString(body.productId);
  const displayOrder = Number.isFinite(body.displayOrder) ? Number(body.displayOrder) : 0;

  if (type !== "subcategory" && type !== "product") {
    return res.status(400).json({ error: "type must be subcategory or product" });
  }

  const collection = await FeaturedCollection.findById(req.params.id);
  if (!collection) return res.status(404).json({ error: "Not found" });

  if (type === "subcategory") {
    if (!subcategoryId || !mongoose.Types.ObjectId.isValid(subcategoryId)) {
      return res.status(400).json({ error: "Valid subcategoryId is required" });
    }
    const subcategory = await Subcategory.findById(subcategoryId);
    if (!subcategory) return res.status(404).json({ error: "Subcategory not found" });

    const duplicate = collection.items.some(
      (item) => item.type === "subcategory" && String(item.subcategoryId) === subcategoryId,
    );
    if (duplicate) return res.status(409).json({ error: "Subcategory already in collection" });

    collection.items.push({
      type: "subcategory",
      subcategoryId: new mongoose.Types.ObjectId(subcategoryId),
      displayOrder,
    } as never);
  } else {
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ error: "Valid productId is required" });
    }
    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ error: "Product not found" });

    const duplicate = collection.items.some(
      (item) => item.type === "product" && String(item.productId) === productId,
    );
    if (duplicate) return res.status(409).json({ error: "Product already in collection" });

    collection.items.push({
      type: "product",
      productId: new mongoose.Types.ObjectId(productId),
      displayOrder,
    } as never);
  }

  try {
    await collection.save();
    const items = await resolveFeaturedCollectionItems(collection);
    return res.status(201).json({ items, rawItems: collection.items });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete(
  "/featured-collections/:id/items/:itemId",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const collection = await FeaturedCollection.findById(req.params.id);
    if (!collection) return res.status(404).json({ error: "Not found" });

    const itemId = req.params.itemId;
    const before = collection.items.length;
    collection.items = collection.items.filter((item) => String(item._id) !== itemId) as never;
    if (collection.items.length === before) {
      return res.status(404).json({ error: "Item not found" });
    }

    try {
      await collection.save();
      const items = await resolveFeaturedCollectionItems(collection);
      return res.status(200).json({ items, rawItems: collection.items });
    } catch {
      return res.status(500).json({ error: "Server error" });
    }
  },
);

export default router;
