import { Router } from "express";

import adminAuthRouter from "./auth";
import adminClientsRouter from "./clients";
import adminUploadsRouter from "./uploads";
import adminBannersRouter from "./banners";
import adminCategoriesRouter from "./categories";
import adminOrdersRouter from "./orders";
import adminFeaturedCollectionsRouter from "./featuredCollections";

const router = Router();

router.use(adminAuthRouter);
router.use(adminClientsRouter);
router.use(adminUploadsRouter);
router.use(adminBannersRouter);
router.use(adminCategoriesRouter);
router.use(adminOrdersRouter);
router.use(adminFeaturedCollectionsRouter);

export default router;

