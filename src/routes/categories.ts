import { Router } from "express";
import mongoose from "mongoose";

import { Category } from "../models/Category";
import { Product } from "../models/Product";
import { Subcategory } from "../models/Subcategory";
import { SubcategoryProfile } from "../models/SubcategoryProfile";

const router = Router();

/** Public endpoint – returns only active categories ordered by displayOrder. */
router.get("/categories", async (_req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .sort({ displayOrder: 1, createdAt: -1 })
      .select("_id name thumbnailImage categoryBannerImages productCount");

    const payload = categories.map((c) => ({
      _id: c._id,
      name: c.name,
      imageUrl: c.thumbnailImage ?? "",
      categoryBannerImages: c.categoryBannerImages ?? [],
      designCount: c.productCount,
    }));

    return res.status(200).json({ categories: payload });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * Public endpoint – returns subcategory profiles for a category, with their subcategories.
 * Used by the mobile app category page to render profile sections.
 */
router.get("/categories/:categoryId/subcategory-profiles", async (req, res) => {
  try {
    const categoryId = req.params.categoryId;
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ error: "Invalid categoryId" });
    }

    const category = await Category.findOne({ _id: categoryId, isActive: true }).select(
      "_id name",
    );
    if (!category) return res.status(404).json({ error: "Category not found" });

    const profiles = await SubcategoryProfile.find({ categoryId, isActive: true }).sort({
      displayOrder: 1,
      createdAt: -1,
    });

    // Legacy fallback: if a category has no profiles, surface subcategories
    // directly under the category name so the app still renders cards.
    if (profiles.length === 0) {
      const subcategories = await Subcategory.find({
        categoryId,
        isActive: true,
      }).sort({ displayOrder: 1, createdAt: -1 });

      const legacyPayload = [
        {
          _id: `legacy-${category._id.toString()}`,
          name: category.name,
          subcategories: subcategories.map((s) => ({
            _id: s._id,
            name: s.name,
            imageUrl: s.thumbnailImage ?? "",
            thumbnailImage: s.thumbnailImage ?? "",
            images: s.images ?? [],
            description: s.description ?? "",
            subtext: s.subtext ?? "",
            designCount: s.productCount ?? 0,
            infoText: s.infoText ?? "",
            filterSchema: s.filterSchema ?? [],
          })),
        },
      ];

      return res.status(200).json({ subcategoryProfiles: legacyPayload });
    }

    const subcategories = await Subcategory.find({
      categoryId,
      isActive: true,
      subcategoryProfileId: { $in: profiles.map((p) => p._id) },
    }).sort({ displayOrder: 1, createdAt: -1 });

    const byProfileId = new Map<string, typeof subcategories>();
    for (const s of subcategories) {
      const pid = s.subcategoryProfileId?.toString();
      if (!pid) continue;
      const existing = byProfileId.get(pid);
      if (existing) existing.push(s);
      else byProfileId.set(pid, [s]);
    }

    const payload = profiles.map((p) => ({
      _id: p._id,
      name: p.name,
      subcategories: (byProfileId.get(p._id.toString()) ?? []).map((s) => ({
        _id: s._id,
        name: s.name,
        imageUrl: s.thumbnailImage ?? "",
        thumbnailImage: s.thumbnailImage ?? "",
        images: s.images ?? [],
        description: s.description ?? "",
        subtext: s.subtext ?? "",
        designCount: s.productCount ?? 0,
        infoText: s.infoText ?? "",
        filterSchema: s.filterSchema ?? [],
      })),
    }));

    return res.status(200).json({ subcategoryProfiles: payload });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

/** Public endpoint – returns active products for a subcategory. */
router.get("/subcategories/:subcategoryId/products", async (req, res) => {
  try {
    const subcategoryId = req.params.subcategoryId;
    if (!mongoose.Types.ObjectId.isValid(subcategoryId)) {
      return res.status(400).json({ error: "Invalid subcategoryId" });
    }

    const products = await Product.find({ subcategoryId, isActive: true })
      .sort({ displayOrder: 1, createdAt: -1 })
      .select(
        "_id styleNo makeType description remarks images isReadyToShip isBestSeller totalDiamondPcs totalDiamondWeightCt pointer metalWeights diamonds filter",
      );

    return res.status(200).json({ products });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
