import assert from "node:assert/strict";
import test from "node:test";

import { normalizeToken } from "./catalogContext";
import { canonicalBulkOrderStoneType } from "./llmParser";
import { resolveAndMatchBulkOrder, isValidCaratOrPointer } from "./resolveAndMatch";

test("normalizeToken collapses case and symbols", () => {
  assert.equal(normalizeToken(" White Gold "), "whitegold");
  assert.equal(normalizeToken("14-KT"), "14kt");
});

test("isValidCaratOrPointer validates carat-like values", () => {
  assert.equal(isValidCaratOrPointer("1.25 ct"), true);
  assert.equal(isValidCaratOrPointer("25 pointer"), true);
  assert.equal(isValidCaratOrPointer(""), false);
});

test("canonicalBulkOrderStoneType accepts Natural / Lab grown variants only", () => {
  assert.equal(canonicalBulkOrderStoneType(""), "");
  assert.equal(canonicalBulkOrderStoneType("Natural"), "Natural");
  assert.equal(canonicalBulkOrderStoneType("lab grown"), "LabGrown");
  assert.equal(canonicalBulkOrderStoneType("LabGrown"), "LabGrown");
  assert.equal(canonicalBulkOrderStoneType("made up"), "");
});

test("resolveAndMatchBulkOrder flags missing fields with options", async () => {
  const result = await resolveAndMatchBulkOrder({
    parsedLines: [
      {
        lineRef: "line_1",
        category: "",
        subcategoryProfile: "",
        subcategory: "",
        filters: {},
        metalType: "white gold",
        stoneType: "lab grown",
        caratOrPointer: "",
        qtyWhite: 0,
        qtyYellow: 0,
        qtyRose: 0,
      },
    ],
    catalogContext: {
      categories: [
        {
          id: "cat1",
          name: "Rings",
          profiles: [{ id: "pro1", name: "Halo", subcategories: [{ id: "sub1", name: "Engagement", filters: [] }] }],
        },
      ],
    },
  });

  assert.equal(result.itemsParsedCount, 1);
  assert.equal(result.itemsResolvedCount, 0);
  assert.equal(result.allResolved, false);
  assert.equal(result.items[0]?.status, "needs_input");
  assert.equal(result.items[0]?.missingFields.length > 0, true);
});

test("resolveAndMatchBulkOrder flags stone type when omitted", async () => {
  const result = await resolveAndMatchBulkOrder({
    parsedLines: [
      {
        lineRef: "line_1",
        category: "Rings",
        subcategoryProfile: "Halo",
        subcategory: "Engagement",
        filters: {},
        metalType: "10kt",
        stoneType: "",
        caratOrPointer: "50 pointer",
        qtyWhite: 2,
        qtyYellow: 0,
        qtyRose: 0,
      },
    ],
    catalogContext: {
      categories: [
        {
          id: "cat1",
          name: "Rings",
          profiles: [
            { id: "pro1", name: "Halo", subcategories: [{ id: "sub1", name: "Engagement", filters: [] }] },
          ],
        },
      ],
    },
  });

  const fields = result.items[0]?.missingFields.map((m) => m.field) || [];
  assert.ok(fields.includes("stoneType"));
});
