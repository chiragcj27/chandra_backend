import { Router } from "express";
import mongoose from "mongoose";

import { FeaturedCollection } from "../models/FeaturedCollection";
import { getResolvedFeaturedCollection } from "../services/featuredCollectionItems";

const router = Router();

/** Public – active featured collections for home carousel. */
router.get("/featured-collections", async (_req, res) => {
  try {
    const collections = await FeaturedCollection.find({ isActive: true })
      .sort({ displayOrder: 1, createdAt: -1 })
      .select("_id name description bannerImageUrl displayOrder");

    const payload = collections.map((c) => ({
      _id: c._id,
      name: c.name,
      description: c.description ?? "",
      bannerImageUrl: c.bannerImageUrl,
      displayOrder: c.displayOrder,
    }));

    return res.status(200).json({ featuredCollections: payload });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

/** Public – collection detail with subcategory/product items. */
router.get("/featured-collections/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid collection id" });
    }

    const collection = await getResolvedFeaturedCollection(id);
    if (!collection) return res.status(404).json({ error: "Collection not found" });

    return res.status(200).json({ collection });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
