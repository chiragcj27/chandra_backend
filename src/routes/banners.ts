import { Router } from "express";

import { Banner } from "../models/Banner";

const router = Router();

/** Public endpoint – returns only active banners ordered by displayOrder. */
router.get("/banners", async (_req, res) => {
  try {
    const banners = await Banner.find({ isActive: true }).sort({ displayOrder: 1, createdAt: -1 });
    return res.status(200).json({ banners });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
