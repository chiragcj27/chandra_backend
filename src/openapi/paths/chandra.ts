import { adminSecured, clientSecured, errResp, jsonResp, ref, standardErrors } from "../base";

/** Reusable parameter helpers. */
const idParam = (name = "id") => ({
  name,
  in: "path",
  required: true,
  schema: { type: "string" as const },
});
const qString = (name: string, description?: string) => ({
  name,
  in: "query",
  required: false,
  schema: { type: "string" as const },
  ...(description ? { description } : {}),
});

export const chandraPaths: Record<string, Record<string, unknown>> = {
  // ───── Health ─────
  "/health": {
    get: {
      tags: ["Health"],
      summary: "Liveness probe",
      responses: { "200": jsonResp("OK", { type: "object" }) },
    },
  },

  // ───── Client auth ─────
  "/auth/login": {
    post: {
      tags: ["Auth (Client)"],
      summary: "Client login",
      requestBody: {
        required: true,
        content: { "application/json": { schema: ref("LoginRequest") } },
      },
      responses: { "200": jsonResp("Logged in", ref("LoginResponse")), "401": errResp("Invalid credentials") },
    },
  },
  "/auth/me": {
    get: {
      tags: ["Auth (Client)"],
      summary: "Current client profile",
      security: clientSecured,
      responses: { "200": jsonResp("Current client"), "401": standardErrors["401"] },
    },
  },

  // ───── Admin auth ─────
  "/admin/auth/login": {
    post: {
      tags: ["Auth (Admin)"],
      summary: "Admin login",
      requestBody: {
        required: true,
        content: { "application/json": { schema: ref("AdminLoginRequest") } },
      },
      responses: { "200": jsonResp("Logged in", ref("LoginResponse")), "401": errResp("Invalid credentials") },
    },
  },

  // ───── Public catalog ─────
  "/categories": {
    get: {
      tags: ["Catalog (Public)"],
      summary: "List active categories with subcategory thumbnails",
      responses: { "200": jsonResp("Category list") },
    },
  },
  "/categories/{categoryId}/subcategory-profiles": {
    get: {
      tags: ["Catalog (Public)"],
      summary: "Subcategory profiles for a category",
      parameters: [idParam("categoryId")],
      responses: { "200": jsonResp("Profiles + their subcategories"), "404": standardErrors["404"] },
    },
  },
  "/subcategories/{subcategoryId}/products": {
    get: {
      tags: ["Catalog (Public)"],
      summary: "Paginated products for a subcategory",
      parameters: [
        idParam("subcategoryId"),
        qString("limit"),
        qString("skip"),
        qString("filters", "JSON-encoded filter object"),
      ],
      responses: { "200": jsonResp("Products + facets") },
    },
  },
  "/best-sellers": {
    get: {
      tags: ["Catalog (Public)"],
      summary: "Best-seller flagged subcategories",
      responses: { "200": jsonResp("List") },
    },
  },
  "/ready-to-ship": {
    get: {
      tags: ["Catalog (Public)"],
      summary: "Ready-to-ship subcategories",
      responses: { "200": jsonResp("List") },
    },
  },
  "/stone-shapes": {
    get: {
      tags: ["Catalog (Public)"],
      summary: "All stone shapes",
      responses: { "200": jsonResp("List") },
    },
  },

  // ───── Search ─────
  "/search": {
    get: {
      tags: ["Search"],
      summary: "Cross-catalog search (categories / subcategories / products)",
      parameters: [qString("q", "Search query"), qString("limit")],
      responses: { "200": jsonResp("Grouped results") },
    },
  },

  // ───── Public banners ─────
  "/banners": {
    get: {
      tags: ["Banners (Public)"],
      summary: "Active banners",
      responses: {
        "200": jsonResp("Banners array", {
          type: "object",
          properties: { banners: { type: "array", items: ref("Banner") } },
        }),
      },
    },
  },

  // ───── Public clients ─────
  "/clients/me/name": {
    get: {
      tags: ["Clients (Public)"],
      summary: "Display name of the currently-logged client",
      security: clientSecured,
      responses: { "200": jsonResp("Display name") },
    },
  },
  "/clients/{id}/name": {
    get: {
      tags: ["Clients (Public)"],
      summary: "Display name by client ID",
      security: clientSecured,
      parameters: [idParam("id")],
      responses: { "200": jsonResp("Display name") },
    },
  },

  // ───── Client orders ─────
  "/orders": {
    post: {
      tags: ["Orders (Client)"],
      summary: "Place a new order",
      security: clientSecured,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["items"],
              properties: {
                items: { type: "array", items: { type: "object", additionalProperties: true } },
                billingAddress: { type: "string" },
                shippingAddress: { type: "string" },
                notes: { type: "string" },
                currency: { type: "string" },
                totalAmount: { type: "number" },
                orderMeta: { type: "object", additionalProperties: true },
              },
            },
          },
        },
      },
      responses: { "201": jsonResp("Order created", ref("ChandraOrder")), ...standardErrors },
    },
  },
  "/orders/my": {
    get: {
      tags: ["Orders (Client)"],
      summary: "Current client's orders",
      security: clientSecured,
      responses: { "200": jsonResp("Order list") },
    },
  },
  "/orders/my/{id}": {
    get: {
      tags: ["Orders (Client)"],
      summary: "Get a single order belonging to current client",
      security: clientSecured,
      parameters: [idParam("id")],
      responses: { "200": jsonResp("Order", ref("ChandraOrder")), "404": standardErrors["404"] },
    },
  },
  "/orders/my/{id}/reorder-payload": {
    get: {
      tags: ["Orders (Client)"],
      summary: "Reorder template payload built from an existing order",
      security: clientSecured,
      parameters: [idParam("id")],
      responses: { "200": jsonResp("Reorder payload"), "404": standardErrors["404"] },
    },
  },

  // ───── Bulk orders ─────
  "/bulk-orders/catalog-context": {
    get: {
      tags: ["Bulk Orders"],
      summary: "Catalog context (styles + stone types) used by the parser",
      security: clientSecured,
      responses: { "200": jsonResp("Catalog context") },
    },
  },
  "/bulk-orders/parse": {
    post: {
      tags: ["Bulk Orders"],
      summary: "Parse text or audio into a structured order",
      security: clientSecured,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                text: { type: "string" },
                audioBase64: { type: "string" },
                excelBase64: { type: "string" },
              },
            },
          },
        },
      },
      responses: { "200": jsonResp("Parsed order payload"), ...standardErrors },
    },
  },
  "/bulk-orders/upload": {
    post: {
      tags: ["Bulk Orders"],
      summary: "Multipart upload variant of the parser (file: audio / excel / text)",
      security: clientSecured,
      requestBody: {
        required: true,
        content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } } },
      },
      responses: { "200": jsonResp("Parsed payload"), ...standardErrors },
    },
  },

  // ───── Public featured collections ─────
  "/featured-collections": {
    get: {
      tags: ["Featured Collections (Public)"],
      summary: "Active featured collections",
      responses: { "200": jsonResp("Collections list") },
    },
  },
  "/featured-collections/{id}": {
    get: {
      tags: ["Featured Collections (Public)"],
      summary: "Featured collection detail (with items)",
      parameters: [idParam("id")],
      responses: { "200": jsonResp("Collection detail"), "404": standardErrors["404"] },
    },
  },

  // ───── Admin: clients ─────
  "/admin/clients": {
    post: {
      tags: ["Admin: Clients"],
      summary: "Create a client account",
      security: adminSecured,
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
      },
      responses: { "201": jsonResp("Created"), ...standardErrors },
    },
  },

  // ───── Admin: catalog ─────
  "/admin/categories": {
    get: {
      tags: ["Admin: Catalog"],
      summary: "All categories (admin)",
      security: adminSecured,
      responses: { "200": jsonResp("List") },
    },
    post: {
      tags: ["Admin: Catalog"],
      summary: "Create category",
      security: adminSecured,
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
      responses: { "201": jsonResp("Created"), ...standardErrors },
    },
  },
  "/admin/categories/{id}": {
    put: {
      tags: ["Admin: Catalog"],
      summary: "Update category",
      security: adminSecured,
      parameters: [idParam("id")],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
      responses: { "200": jsonResp("Updated"), ...standardErrors },
    },
    delete: {
      tags: ["Admin: Catalog"],
      summary: "Delete category",
      security: adminSecured,
      parameters: [idParam("id")],
      responses: { "200": jsonResp("Deleted", ref("OkResponse")), ...standardErrors },
    },
  },
  "/admin/stone-shapes": {
    get: {
      tags: ["Admin: Catalog"],
      summary: "List stone shapes",
      security: adminSecured,
      responses: { "200": jsonResp("List") },
    },
    post: {
      tags: ["Admin: Catalog"],
      summary: "Create stone shape",
      security: adminSecured,
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
      responses: { "201": jsonResp("Created"), ...standardErrors },
    },
  },
  "/admin/stone-shapes/{id}": {
    put: {
      tags: ["Admin: Catalog"],
      summary: "Update stone shape",
      security: adminSecured,
      parameters: [idParam("id")],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
      responses: { "200": jsonResp("Updated"), ...standardErrors },
    },
    delete: {
      tags: ["Admin: Catalog"],
      summary: "Delete stone shape",
      security: adminSecured,
      parameters: [idParam("id")],
      responses: { "200": jsonResp("Deleted", ref("OkResponse")), ...standardErrors },
    },
  },
  "/admin/subcategory-profiles": {
    get: {
      tags: ["Admin: Catalog"],
      summary: "List subcategory profiles",
      security: adminSecured,
      parameters: [qString("categoryId")],
      responses: { "200": jsonResp("List") },
    },
    post: {
      tags: ["Admin: Catalog"],
      summary: "Create subcategory profile",
      security: adminSecured,
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
      responses: { "201": jsonResp("Created"), ...standardErrors },
    },
  },
  "/admin/subcategory-profiles/{id}": {
    put: {
      tags: ["Admin: Catalog"],
      summary: "Update subcategory profile",
      security: adminSecured,
      parameters: [idParam("id")],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
      responses: { "200": jsonResp("Updated"), ...standardErrors },
    },
    delete: {
      tags: ["Admin: Catalog"],
      summary: "Delete subcategory profile",
      security: adminSecured,
      parameters: [idParam("id")],
      responses: { "200": jsonResp("Deleted", ref("OkResponse")), ...standardErrors },
    },
  },
  "/admin/subcategories": {
    get: {
      tags: ["Admin: Catalog"],
      summary: "List subcategories",
      security: adminSecured,
      parameters: [qString("categoryId")],
      responses: { "200": jsonResp("List") },
    },
    post: {
      tags: ["Admin: Catalog"],
      summary: "Create subcategory",
      security: adminSecured,
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
      responses: { "201": jsonResp("Created"), ...standardErrors },
    },
  },
  "/admin/subcategories/{id}": {
    put: {
      tags: ["Admin: Catalog"],
      summary: "Update subcategory",
      security: adminSecured,
      parameters: [idParam("id")],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
      responses: { "200": jsonResp("Updated"), ...standardErrors },
    },
    delete: {
      tags: ["Admin: Catalog"],
      summary: "Delete subcategory",
      security: adminSecured,
      parameters: [idParam("id")],
      responses: { "200": jsonResp("Deleted", ref("OkResponse")), ...standardErrors },
    },
  },
  "/admin/products": {
    get: {
      tags: ["Admin: Catalog"],
      summary: "List products",
      security: adminSecured,
      parameters: [qString("subcategoryId"), qString("q"), qString("limit"), qString("skip")],
      responses: { "200": jsonResp("List") },
    },
    post: {
      tags: ["Admin: Catalog"],
      summary: "Create product",
      security: adminSecured,
      requestBody: { required: true, content: { "application/json": { schema: ref("Product") } } },
      responses: { "201": jsonResp("Created"), ...standardErrors },
    },
  },
  "/admin/products/bulk": {
    post: {
      tags: ["Admin: Catalog"],
      summary: "Bulk-create products",
      security: adminSecured,
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
      responses: { "200": jsonResp("Bulk result"), ...standardErrors },
    },
  },
  "/admin/products/{id}": {
    put: {
      tags: ["Admin: Catalog"],
      summary: "Update product",
      security: adminSecured,
      parameters: [idParam("id")],
      requestBody: { required: true, content: { "application/json": { schema: ref("Product") } } },
      responses: { "200": jsonResp("Updated"), ...standardErrors },
    },
    delete: {
      tags: ["Admin: Catalog"],
      summary: "Delete product",
      security: adminSecured,
      parameters: [idParam("id")],
      responses: { "200": jsonResp("Deleted", ref("OkResponse")), ...standardErrors },
    },
  },

  // ───── Admin: banners ─────
  "/admin/banners": {
    get: {
      tags: ["Admin: Banners"],
      summary: "List banners",
      security: adminSecured,
      responses: { "200": jsonResp("List") },
    },
    post: {
      tags: ["Admin: Banners"],
      summary: "Create banner (after presigned upload)",
      security: adminSecured,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["title", "tmpKey"],
              properties: {
                title: { type: "string" },
                linkUrl: { type: "string" },
                tmpKey: { type: "string" },
                displayOrder: { type: "integer" },
                isActive: { type: "boolean" },
              },
            },
          },
        },
      },
      responses: { "201": jsonResp("Created", ref("Banner")), ...standardErrors },
    },
  },
  "/admin/banners/{id}": {
    put: {
      tags: ["Admin: Banners"],
      summary: "Update banner",
      security: adminSecured,
      parameters: [idParam("id")],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
      responses: { "200": jsonResp("Updated"), ...standardErrors },
    },
    delete: {
      tags: ["Admin: Banners"],
      summary: "Delete banner",
      security: adminSecured,
      parameters: [idParam("id")],
      responses: { "200": jsonResp("Deleted", ref("OkResponse")), ...standardErrors },
    },
  },

  // ───── Admin: featured collections ─────
  "/admin/featured-collections": {
    get: {
      tags: ["Admin: Featured Collections"],
      summary: "List featured collections",
      security: adminSecured,
      responses: { "200": jsonResp("List") },
    },
    post: {
      tags: ["Admin: Featured Collections"],
      summary: "Create featured collection",
      security: adminSecured,
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
      responses: { "201": jsonResp("Created"), ...standardErrors },
    },
  },
  "/admin/featured-collections/eligible-subcategories": {
    get: {
      tags: ["Admin: Featured Collections"],
      summary: "Subcategories eligible for highlighting",
      security: adminSecured,
      responses: { "200": jsonResp("List") },
    },
  },
  "/admin/featured-collections/{id}": {
    get: {
      tags: ["Admin: Featured Collections"],
      summary: "Featured collection detail",
      security: adminSecured,
      parameters: [idParam("id")],
      responses: { "200": jsonResp("Detail"), "404": standardErrors["404"] },
    },
    put: {
      tags: ["Admin: Featured Collections"],
      summary: "Update featured collection",
      security: adminSecured,
      parameters: [idParam("id")],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
      responses: { "200": jsonResp("Updated"), ...standardErrors },
    },
    delete: {
      tags: ["Admin: Featured Collections"],
      summary: "Delete featured collection",
      security: adminSecured,
      parameters: [idParam("id")],
      responses: { "200": jsonResp("Deleted", ref("OkResponse")), ...standardErrors },
    },
  },
  "/admin/featured-collections/{id}/items": {
    post: {
      tags: ["Admin: Featured Collections"],
      summary: "Add item to featured collection",
      security: adminSecured,
      parameters: [idParam("id")],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
      responses: { "200": jsonResp("Updated collection"), ...standardErrors },
    },
  },
  "/admin/featured-collections/{id}/items/{itemId}": {
    delete: {
      tags: ["Admin: Featured Collections"],
      summary: "Remove item from featured collection",
      security: adminSecured,
      parameters: [idParam("id"), idParam("itemId")],
      responses: { "200": jsonResp("Updated"), ...standardErrors },
    },
  },

  // ───── Admin: orders ─────
  "/admin/orders": {
    get: {
      tags: ["Admin: Orders"],
      summary: "List orders (admin)",
      security: adminSecured,
      parameters: [qString("status"), qString("clientId"), qString("limit"), qString("skip")],
      responses: { "200": jsonResp("List") },
    },
  },
  "/admin/orders/{id}": {
    get: {
      tags: ["Admin: Orders"],
      summary: "Get order by id",
      security: adminSecured,
      parameters: [idParam("id")],
      responses: { "200": jsonResp("Order", ref("ChandraOrder")), "404": standardErrors["404"] },
    },
  },
  "/admin/orders/{id}/status": {
    patch: {
      tags: ["Admin: Orders"],
      summary: "Transition order status",
      security: adminSecured,
      parameters: [idParam("id")],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["status"],
              properties: {
                status: { type: "string" },
                note: { type: "string" },
                shipmentTracking: { type: "object", additionalProperties: true },
              },
            },
          },
        },
      },
      responses: { "200": jsonResp("Updated", ref("ChandraOrder")), ...standardErrors },
    },
  },
  "/admin/orders/{id}/cancel": {
    patch: {
      tags: ["Admin: Orders"],
      summary: "Cancel an order (only from order_received)",
      security: adminSecured,
      parameters: [idParam("id")],
      requestBody: {
        required: false,
        content: { "application/json": { schema: { type: "object", properties: { note: { type: "string" } } } } },
      },
      responses: { "200": jsonResp("Cancelled", ref("ChandraOrder")), ...standardErrors },
    },
  },
  "/admin/orders/{id}/invoices/presign": {
    post: {
      tags: ["Admin: Orders"],
      summary: "Get presigned S3 URL to upload an invoice for an order",
      security: adminSecured,
      parameters: [idParam("id")],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
      responses: { "200": jsonResp("Presign URL"), ...standardErrors },
    },
  },
  "/admin/orders/{id}/invoices": {
    post: {
      tags: ["Admin: Orders"],
      summary: "Confirm uploaded invoice (after presigned PUT)",
      security: adminSecured,
      parameters: [idParam("id")],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
      responses: { "200": jsonResp("Order with invoice"), ...standardErrors },
    },
  },
  "/admin/orders/{id}/invoices/{invoiceId}": {
    delete: {
      tags: ["Admin: Orders"],
      summary: "Delete an invoice",
      security: adminSecured,
      parameters: [idParam("id"), idParam("invoiceId")],
      responses: { "200": jsonResp("Order without that invoice"), ...standardErrors },
    },
  },

  // ───── Admin: uploads (S3) ─────
  "/admin/uploads/presign": {
    post: {
      tags: ["Admin: Uploads"],
      summary: "Get a presigned S3 PUT URL",
      security: adminSecured,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["folder", "filename", "contentType"],
              properties: {
                folder: { type: "string" },
                filename: { type: "string" },
                contentType: { type: "string" },
              },
            },
          },
        },
      },
      responses: { "200": jsonResp("Presigned URL + final key"), ...standardErrors },
    },
  },
  "/admin/uploads/list": {
    get: {
      tags: ["Admin: Uploads"],
      summary: "List uploaded files under a folder",
      security: adminSecured,
      parameters: [qString("prefix"), qString("limit"), qString("continuationToken")],
      responses: { "200": jsonResp("File list") },
    },
  },
  "/admin/uploads": {
    delete: {
      tags: ["Admin: Uploads"],
      summary: "Delete an uploaded file by key",
      security: adminSecured,
      parameters: [qString("key")],
      responses: { "200": jsonResp("OK", ref("OkResponse")), ...standardErrors },
    },
  },
};
