import { Router } from "express";
import swaggerUi from "swagger-ui-express";

import { openapiDocument } from "./openapi";

/**
 * Mounts Swagger UI at `/docs` and serves the raw spec at `/docs/openapi.json`.
 *
 * Auth: unauthenticated by default — typical for an internal API docs page.
 * If you want to gate it, wrap `router` with `requireAuth + requireRole("admin")`
 * in `routes/index.ts` (similar pattern to other admin routes).
 */
const router = Router();

// Raw JSON endpoint (handy for `redoc-cli` / `openapi-typescript` codegen on the FE side).
router.get("/docs/openapi.json", (_req, res) => {
  res.status(200).json(openapiDocument);
});

router.use(
  "/docs",
  swaggerUi.serve,
  swaggerUi.setup(openapiDocument as unknown as Record<string, unknown>, {
    customSiteTitle: "Chandra Backend API Docs",
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: "none",
      defaultModelsExpandDepth: 0,
      tagsSorter: "alpha",
    },
  })
);

export default router;
