import { info, schemas, securitySchemes, servers, tags } from "./base";
import { chandraPaths } from "./paths/chandra";
import { productionConfigPaths } from "./paths/productionConfig";
import { productionOpsPaths } from "./paths/productionOps";

/**
 * Final OpenAPI 3.0.3 document, assembled from the modular sources under
 * `paths/`. Served by Swagger UI at GET /docs.
 */
export const openapiDocument = {
  openapi: "3.0.3",
  info,
  servers,
  tags,
  components: {
    securitySchemes,
    schemas,
  },
  paths: {
    ...chandraPaths,
    ...productionConfigPaths,
    ...productionOpsPaths,
  },
} as const;

export type OpenAPIDocument = typeof openapiDocument;
