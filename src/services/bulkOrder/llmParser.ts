import { env } from "../../config/env";
import type { BulkOrderCatalogCategory } from "./catalogContext";

export type ParsedBulkOrderLine = {
  lineRef: string;
  category: string;
  subcategoryProfile: string;
  subcategory: string;
  filters: Record<string, string | string[]>;
  metalType: string;
  stoneType: string;
  caratOrPointer: string;
  qtyWhite: number;
  qtyYellow: number;
  qtyRose: number;
};

type OpenAiResponse = {
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

function toSafeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Normalizes LLM output; only Natural / LabGrown are valid non-empty values. */
export function canonicalBulkOrderStoneType(value: string): "" | "Natural" | "LabGrown" {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const compact = raw.replace(/[\s_-]+/g, "");
  if (compact === "natural") return "Natural";
  if (compact === "labgrown" || raw === "lg") return "LabGrown";
  if (raw.includes("lab") && raw.includes("grown")) return "LabGrown";
  if (raw === "cvd" || raw === "hpht") return "LabGrown";
  return "";
}

function rawTextIndicatesNatural(text: string): boolean {
  return /\bnatural\b/i.test(text);
}

function rawTextIndicatesLab(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\blab[\s-]*grown\b/.test(t) ||
    /\blabgrown\b/.test(t) ||
    /\bcvd\b/.test(t) ||
    /\bhpht\b/.test(t) ||
    /\blg\b/.test(t)
  );
}

/** Drops stoneType values not supported by explicit wording in the user text (anti-hallucination). */
function reconcileParsedStoneTypesWithRawText(
  rawText: string,
  lines: ParsedBulkOrderLine[],
): ParsedBulkOrderLine[] {
  const text = String(rawText || "");
  const nat = rawTextIndicatesNatural(text);
  const lab = rawTextIndicatesLab(text);
  if (nat && lab) {
    return lines.map((l) => ({ ...l, stoneType: "" }));
  }
  return lines.map((l) => {
    const c = canonicalBulkOrderStoneType(l.stoneType);
    if (c === "LabGrown" && !lab) return { ...l, stoneType: "" };
    if (c === "Natural" && !nat) return { ...l, stoneType: "" };
    return { ...l, stoneType: c };
  });
}

function coerceLine(raw: unknown, index: number): ParsedBulkOrderLine {
  const line =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    lineRef: String(line.lineRef || `line_${index + 1}`),
    category: String(line.category || "").trim(),
    subcategoryProfile: String(line.subcategoryProfile || "").trim(),
    subcategory: String(line.subcategory || "").trim(),
    filters:
      line.filters && typeof line.filters === "object"
        ? (line.filters as Record<string, string | string[]>)
        : {},
    metalType: String(line.metalType || "").trim(),
    stoneType: canonicalBulkOrderStoneType(String(line.stoneType || "").trim()),
    caratOrPointer: String(line.caratOrPointer || "").trim(),
    qtyWhite: Math.max(0, toSafeNumber(line.qtyWhite)),
    qtyYellow: Math.max(0, toSafeNumber(line.qtyYellow)),
    qtyRose: Math.max(0, toSafeNumber(line.qtyRose)),
  };
}

function extractText(response: OpenAiResponse): string {
  const chunks = response.output || [];
  for (const chunk of chunks) {
    for (const content of chunk.content || []) {
      if (content.type === "output_text" && content.text) {
        return content.text;
      }
    }
  }
  return "";
}

export async function parseBulkOrderWithLlm(args: {
  rawText: string;
  catalogContext: { categories: BulkOrderCatalogCategory[] };
}): Promise<ParsedBulkOrderLine[]> {
  if (!env.OPENAI_API_KEY) {
    console.warn(
      "[BulkOrderLLM] OPENAI_API_KEY missing; returning empty parse",
    );
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1000, env.BULK_ORDER_PARSE_TIMEOUT_MS),
  );
  const startedAt = Date.now();

  try {
    console.log("[BulkOrderLLM] parse started", {
      model: env.BULK_ORDER_OPENAI_MODEL,
      timeoutMs: env.BULK_ORDER_PARSE_TIMEOUT_MS,
      rawTextLength: args.rawText.length,
      categoriesInContext: args.catalogContext.categories.length,
    });
    const prompt = `You are a deterministic JSON extraction engine for jewellery bulk orders.

You MUST behave like a strict parser, not an AI assistant.

--------------------------------------------------
OUTPUT RULES
--------------------------------------------------
- Return ONLY a valid JSON array.
- Do NOT include markdown, explanations, or extra text.
- Each item MUST strictly follow the schema.
- Do NOT include extra or missing fields.

--------------------------------------------------
SCHEMA (ALL FIELDS REQUIRED)
--------------------------------------------------
- lineRef (string: "line_1", "line_2", ...)
- category (string)
- subcategoryProfile (string)
- subcategory (string)
- filters (object: only keys that exist as filter names in catalog context; values must exactly match that filter's allowed values when set; otherwise {})
- metalType (string)
- stoneType (string: "Natural" | "LabGrown" | "")
- caratOrPointer (string)
- qtyWhite (number)
- qtyYellow (number)
- qtyRose (number)

--------------------------------------------------
STRICT EXTRACTION RULES
--------------------------------------------------
1. DO NOT infer, assume, or guess values.
2. ONLY extract values explicitly present in the input text.
3. If a value is missing:
   - string → ""
   - number → 0
   - filters → {}
4. Preserve original text EXACTLY where applicable (e.g., "10K", "75 pointers", "1.5 carat").
5. DO NOT convert units or wording EXCEPT where explicitly defined (stoneType mapping).

--------------------------------------------------
NOISE FILTERING RULE
--------------------------------------------------
- Ignore irrelevant or conversational text such as:
  "pls send", "ASAP", greetings, filler words, or comments.
- Only process structured order-related content.

--------------------------------------------------
HEADER CONTEXT RULE (CRITICAL)
--------------------------------------------------
- If a header defines attributes (metal, stone, category, etc.),
  APPLY those values to all subsequent groups.
- If a NEW header appears later, OVERRIDE previous context from that point forward.

--------------------------------------------------
GROUP / CARAT / POINTER PARSING RULE
--------------------------------------------------
- Each group is defined by:
  - "<number> pointer" or "<number> pointers"
  - "<number> carat" or "<number> carats"
  - OR a standalone number (e.g., "75", "1.5") FOLLOWED by quantity/color data

- Treat standalone numbers as caratOrPointer ONLY if clearly associated with quantities.

- Each group = ONE item.
- NEVER merge multiple groups.

--------------------------------------------------
INLINE PARSING RULE
--------------------------------------------------
- Do NOT rely on line breaks.
- Treat entire input as a continuous token stream.
- Correctly extract even if input is a single messy line.

--------------------------------------------------
QUANTITY PARSING RULES
--------------------------------------------------
Support ALL formats:

FORMAT A (dash):
- "10-white" → qtyWhite = 10
- "5-yellow" → qtyYellow = 5
- "2-rose" → qtyRose = 2

FORMAT B (X format):
- "Yellow gold X 4" → qtyYellow = 4
- "White gold X 2" → qtyWhite = 2
- "Rose gold X 2" → qtyRose = 2

FORMAT C (abbreviations):
- "wg 2", "2 wg", "2wg" → qtyWhite = 2
- "yg 5", "5 yg", "5yg" → qtyYellow = 5
- "rg 3", "3 rg", "3rg" → qtyRose = 3

FORMAT D (single letters):
- "W 2" → qtyWhite = 2
- "Y 3" → qtyYellow = 3
- "R 1" → qtyRose = 1

MAPPING:
- wg / w → White
- yg / y → Yellow
- rg / r → Rose

RULES:
- Case insensitive
- Ignore words like "gold"
- If multiple entries for same color → SUM quantities
- If color missing → default 0

--------------------------------------------------
STONE TYPE RULE (CONTROLLED MAPPING)
--------------------------------------------------
- Map stoneType ONLY to:
  - "Natural"
  - "LabGrown"

LABGROWN → if input contains ANY of (case insensitive; "lg" only as a whole word, not inside other words):
- "lab grown", "lab-grown", "labgrown", "lg", "CVD", "HPHT"

NATURAL → if input contains:
- "natural"

RULES:
- Case insensitive
- Must be explicitly present in text
- DO NOT infer from product type

CONFLICT:
- If both Natural and Lab indicators appear → return ""

MISSING:
- If no keyword found → return ""

--------------------------------------------------
CATEGORY / SUBCATEGORY RULES
--------------------------------------------------
- ONLY use values that EXACTLY match catalog context.
- NO guessing, NO fuzzy mapping, NO synonyms.
- If no exact match → return ""

--------------------------------------------------
METAL TYPE RULE
--------------------------------------------------
- Extract ONLY if explicitly present (e.g., "10K", "14kt").
- DO NOT normalize.

--------------------------------------------------
LINE REF RULE
--------------------------------------------------
- Assign sequential IDs:
  line_1, line_2, line_3, ...

--------------------------------------------------
NO-HALLUCINATION ENFORCEMENT
--------------------------------------------------
- If uncertain → return empty string or 0
- NEVER fabricate values
- NEVER fill missing fields with assumptions

--------------------------------------------------
VALIDATION CHECK (MANDATORY)
--------------------------------------------------
Before returning:
- Ensure valid JSON array
- Ensure all fields exist in each object
- Ensure no group merging
- Ensure no inferred or fabricated values

--------------------------------------------------
INPUT
--------------------------------------------------

Catalog context:
${JSON.stringify(args.catalogContext)}

User order text:
${args.rawText}`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.BULK_ORDER_OPENAI_MODEL,
        input: prompt,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error("[BulkOrderLLM] parse failed with non-200", {
        status: response.status,
        body: errorText.slice(0, 400),
      });
      return [];
    }

    const data = (await response.json()) as OpenAiResponse;
    const text = extractText(data);
    if (!text) {
      console.warn("[BulkOrderLLM] empty output text received");
      return [];
    }
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      console.warn("[BulkOrderLLM] output was not an array");
      return [];
    }
    const lines = reconcileParsedStoneTypesWithRawText(
      args.rawText,
      parsed.map((line, index) => coerceLine(line, index)),
    );
    console.log("[BulkOrderLLM] parse success", {
      linesCount: lines.length,
      elapsedMs: Date.now() - startedAt,
    });
    return lines;
  } catch (error) {
    console.error("[BulkOrderLLM] parse crashed", {
      message: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
    });
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
