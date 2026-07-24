import { Router } from "express";

import { requireAuth, requireRole } from "../middleware/requireAuth";
import { Category } from "../models/Category";
import { ClientUser } from "../models/ClientUser";
import { Counter } from "../models/Counter";
import { LegacyClient } from "../models/LegacyClient";
import { Order } from "../models/Order";
import { Product } from "../models/Product";
import { Subcategory } from "../models/Subcategory";
import { SubcategoryProfile } from "../models/SubcategoryProfile";

const router = Router();

const ORDER_NUMBER_START = 10000;

async function createOrderNumber(): Promise<string> {
  const counter = await Counter.findByIdAndUpdate(
    "orderNumber",
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  const seq = (counter?.seq ?? 1) + ORDER_NUMBER_START - 1;
  return String(seq);
}

async function buildEnrichedOrderItems(
  items: Array<{
    productId?: string;
    styleNo?: string;
    title?: string;
    imageUrl?: string;
    quantity?: number;
    unitPrice?: number;
    lineTotal?: number;
    remarks?: string;
    meta?: Record<string, unknown>;
  }>
) {
  return Promise.all(
    items.map(async (item) => {
      let product =
        item.productId
          ? await Product.findById(item.productId)
              .select(
                "styleNo categoryId subcategoryId subcategoryProfileId makeType description remarks pointer totalDiamondWeightCt totalDiamondPcs filter images metalWeights"
              )
              .lean()
              .catch(() => null)
          : null;

      if (!product && item.styleNo) {
        product = await Product.findOne({ styleNo: item.styleNo })
          .select(
            "styleNo categoryId subcategoryId subcategoryProfileId makeType description remarks pointer totalDiamondWeightCt totalDiamondPcs filter images metalWeights"
          )
          .lean()
          .catch(() => null);
      }

      const [category, subcategory, subcategoryProfile] = await Promise.all([
        product?.categoryId ? Category.findById(product.categoryId).select("name").lean().catch(() => null) : null,
        product?.subcategoryId ? Subcategory.findById(product.subcategoryId).select("name").lean().catch(() => null) : null,
        product?.subcategoryProfileId
          ? SubcategoryProfile.findById(product.subcategoryProfileId).select("name").lean().catch(() => null)
          : null,
      ]);

      const existingMeta = item.meta && typeof item.meta === "object" ? item.meta : {};

      return {
        productId: item.productId || (product?._id ? String(product._id) : undefined),
        styleNo: item.styleNo || product?.styleNo,
        title: item.title || product?.description || product?.styleNo,
        imageUrl: item.imageUrl || product?.images?.[0] || "",
        quantity: Number(item.quantity),
        unitPrice: Number.isFinite(item.unitPrice) ? Number(item.unitPrice) : undefined,
        lineTotal: Number.isFinite(item.lineTotal) ? Number(item.lineTotal) : undefined,
        remarks: item.remarks,
        meta: {
          ...existingMeta,
          productSnapshot: product
            ? {
                productId: String(product._id),
                styleNo: product.styleNo,
                categoryId: product.categoryId ? String(product.categoryId) : undefined,
                categoryName: category?.name,
                subcategoryId: product.subcategoryId ? String(product.subcategoryId) : undefined,
                subcategoryName: subcategory?.name,
                subcategoryProfileId: product.subcategoryProfileId ? String(product.subcategoryProfileId) : undefined,
                subcategoryProfileName: subcategoryProfile?.name,
                makeType: product.makeType,
                description: product.description,
                remarks: product.remarks,
                pointer: product.pointer,
                totalDiamondWeightCt: product.totalDiamondWeightCt,
                totalDiamondPcs: product.totalDiamondPcs,
                filter: product.filter,
                metalWeights: product.metalWeights,
                images: product.images,
              }
            : null,
        },
      };
    })
  );
}

router.post("/orders", requireAuth, requireRole(["client", "admin"]), async (req, res) => {
  try {
    const requesterId = req.user?.id;
    if (!requesterId) return res.status(401).json({ error: "Unauthorized" });

    const isAdmin = req.user?.role === "admin";

    const body = req.body as {
      clientId?: string;
      items?: Array<{
        productId?: string;
        styleNo?: string;
        title?: string;
        imageUrl?: string;
        quantity?: number;
        unitPrice?: number;
        lineTotal?: number;
        remarks?: string;
        meta?: Record<string, unknown>;
      }>;
      billingAddress?: string;
      shippingAddress?: string;
      notes?: string;
      currency?: string;
      totalAmount?: number;
      orderMeta?: Record<string, unknown>;
    };

    let targetClientId = requesterId;
    if (isAdmin) {
      const requestedClientId = String(body.clientId || "").trim();
      if (!/^[a-f0-9]{24}$/i.test(requestedClientId)) {
        return res.status(400).json({ error: "A valid clientId is required to place an order as admin" });
      }
      targetClientId = requestedClientId;
    }

    const tokenUsername = String(req.user?.username || req.user?.email || "").trim();
    const tokenClientName = String(req.user?.clientName || "").trim();
    const client = await ClientUser.findById(targetClientId).select("clientName username").catch(() => null);
    const clientByUsername =
      !client && !isAdmin && tokenUsername
        ? await ClientUser.findOne({ username: tokenUsername.toLowerCase() }).select("clientName username")
        : null;
    const legacyClient = await LegacyClient.findById(targetClientId).select("Name").catch(() => null);
    const legacyClientName = String(legacyClient?.Name || "").trim();
    const resolvedClient = client || clientByUsername;

    if (isAdmin && !resolvedClient && !legacyClientName) {
      return res.status(404).json({ error: "Client not found" });
    }

    const resolvedClientUsername =
      resolvedClient?.username ||
      (!isAdmin && (tokenUsername.includes("@") ? tokenUsername.split("@")[0] : tokenUsername)) ||
      `client_${String(targetClientId).slice(-6)}`;
    const resolvedClientName =
      resolvedClient?.clientName ||
      legacyClientName ||
      (!isAdmin && tokenClientName) ||
      resolvedClientUsername;

    if (!resolvedClientUsername || !resolvedClientName) {
      return res.status(400).json({
        error:
          "Client identity not resolved. Ensure token includes username/email/clientName or create mapped ClientUser.",
      });
    }

    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) {
      return res.status(400).json({ error: "At least one order item is required" });
    }
    if (!body.shippingAddress?.trim()) {
      return res.status(400).json({ error: "shippingAddress is required" });
    }
    if (!body.currency?.trim()) {
      return res.status(400).json({ error: "currency is required" });
    }

    const invalidItem = items.find(
      (item) =>
        !item ||
        (!item.productId && !item.styleNo) ||
        !Number.isFinite(item.quantity) ||
        Number(item.quantity) < 1
    );
    if (invalidItem) {
      return res
        .status(400)
        .json({ error: "Each order item must include productId or styleNo, and quantity >= 1" });
    }

    const now = new Date();
    const enrichedItems = await buildEnrichedOrderItems(items);
    const orderNumber = await createOrderNumber();
    const order = await Order.create({
      orderNumber,
      clientId: String(targetClientId),
      clientName: resolvedClientName,
      clientUsername: resolvedClientUsername,
      placedByAdminId: isAdmin ? String(requesterId) : undefined,
      status: "order_received",
      items: enrichedItems,
      billingAddress: body.billingAddress,
      shippingAddress: body.shippingAddress,
      notes: body.notes,
      currency: body.currency,
      totalAmount: Number.isFinite(body.totalAmount) ? Number(body.totalAmount) : undefined,
      orderMeta: body.orderMeta,
      timeline: [
        {
          status: "order_received",
          changedAt: now,
          changedBy: { id: String(requesterId), role: isAdmin ? "admin" : "client" },
          note: isAdmin ? "Order placed by admin on behalf of client" : "Order created by client",
        },
      ],
    });

    return res.status(201).json({ order });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/orders/my", requireAuth, requireRole("client"), async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const orders = await Order.find({ clientId: String(userId) }).sort({ createdAt: -1 });
    return res.status(200).json({ orders });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/orders/my/:id", requireAuth, requireRole("client"), async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const order = await Order.findOne({ _id: req.params.id, clientId: String(userId) });
    if (!order) return res.status(404).json({ error: "Order not found" });

    return res.status(200).json({ order });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/orders/my/:id/reorder-payload", requireAuth, requireRole("client"), async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const order = await Order.findOne({ _id: req.params.id, clientId: String(userId) });
    if (!order) return res.status(404).json({ error: "Order not found" });

    return res.status(200).json({
      cart: {
        sourceOrderId: order._id,
        sourceOrderNumber: order.orderNumber,
        currency: order.currency,
        billingAddress: order.billingAddress,
        shippingAddress: order.shippingAddress,
        notes: order.notes,
        items: order.items.map((item) => ({
          productId: item.productId,
          styleNo: item.styleNo,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          remarks: item.remarks,
          meta: item.meta,
        })),
      },
    });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
