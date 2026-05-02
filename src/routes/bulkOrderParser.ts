import { Router } from "express";
import multer from "multer";

import { requireAuth, requireRole } from "../middleware/requireAuth";
import { buildBulkOrderCatalogContext } from "../services/bulkOrder/catalogContext";
import { transcribeBulkOrderAudio } from "../services/bulkOrder/deepgramTranscribe";
import { parseBulkOrderWithLlm } from "../services/bulkOrder/llmParser";
import { resolveAndMatchBulkOrder } from "../services/bulkOrder/resolveAndMatch";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const createRequestId = () =>
  `bop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

router.get("/bulk-orders/catalog-context", requireAuth, requireRole("client"), async (_req, res) => {
  try {
    console.log("[BulkOrderParser] GET /bulk-orders/catalog-context started");
    const context = await buildBulkOrderCatalogContext();
    console.log("[BulkOrderParser] GET /bulk-orders/catalog-context success", {
      categories: context.categories.length,
    });
    return res.status(200).json(context);
  } catch (error) {
    console.error("[BulkOrderParser] GET /bulk-orders/catalog-context failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/bulk-orders/parse", requireAuth, requireRole("client"), async (req, res) => {
  const requestId = createRequestId();
  try {
    const body = req.body as {
      rawText?: string;
      parsedLines?: Array<Record<string, unknown>>;
      overrides?: Record<string, Record<string, unknown>>;
    };

    const rawText = String(body.rawText || "").trim();
    const hasParsedLines = Array.isArray(body.parsedLines) && body.parsedLines.length > 0;
    if (!rawText && !hasParsedLines) {
      return res.status(400).json({ error: "rawText or parsedLines is required" });
    }

    console.log("[BulkOrderParser] POST /bulk-orders/parse started", {
      requestId,
      hasRawText: !!rawText,
      rawTextLength: rawText.length,
      hasParsedLines,
      parsedLinesCount: hasParsedLines ? body.parsedLines?.length : 0,
      overridesCount: body.overrides ? Object.keys(body.overrides).length : 0,
      userId: req.user?.id,
    });

    const catalogContext = await buildBulkOrderCatalogContext();
    const parsedLines = hasParsedLines
      ? (body.parsedLines as Array<any>)
      : await parseBulkOrderWithLlm({
          rawText,
          catalogContext,
        });
    console.log("[BulkOrderParser] parse stage complete", {
      requestId,
      parsedLinesCount: parsedLines.length,
      parseMode: hasParsedLines ? "client-provided" : "llm",
    });
    if (!parsedLines.length) {
      console.warn("[BulkOrderParser] no parsable lines found");
      return res.status(200).json({
        requestId,
        itemsParsedCount: 0,
        itemsResolvedCount: 0,
        items: [],
        allResolved: false,
        orderReviewPayload: null,
        error: "No parsable items found. Please edit text or fill items manually.",
      });
    }

    const resolved = await resolveAndMatchBulkOrder({
      parsedLines,
      overrides: body.overrides,
      catalogContext,
    });
    console.log("[BulkOrderParser] resolve stage complete", {
      requestId,
      itemsParsedCount: resolved.itemsParsedCount,
      itemsResolvedCount: resolved.itemsResolvedCount,
      allResolved: resolved.allResolved,
    });
    return res.status(200).json({
      requestId,
      ...resolved,
      parsedLines,
    });
  } catch (error) {
    console.error("[BulkOrderParser] POST /bulk-orders/parse failed", {
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ error: "Server error" });
  }
});

router.post(
  "/bulk-orders/transcribe",
  requireAuth,
  requireRole("client"),
  upload.single("audio"),
  async (req, res) => {
    try {
      const file = req.file;
      console.log("[BulkOrderParser] POST /bulk-orders/transcribe started", {
        hasFile: !!file,
        size: Number(file?.size || 0),
        mimetype: String(file?.mimetype || ""),
        userId: req.user?.id,
      });
      if (!file || !file.buffer || !file.buffer.length) {
        return res.status(400).json({ error: "audio file is required" });
      }

      const transcript = await transcribeBulkOrderAudio({
        audioBuffer: file.buffer,
        mimetype: file.mimetype || "audio/mpeg",
      });

      return res.status(200).json({
        transcript,
        transcriptLength: transcript.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[BulkOrderParser] POST /bulk-orders/transcribe failed", { message });
      const status = message.includes("DEEPGRAM_API_KEY is not configured") ? 503 : 500;
      return res.status(status).json({ error: message || "Failed to transcribe audio" });
    }
  },
);

export default router;
