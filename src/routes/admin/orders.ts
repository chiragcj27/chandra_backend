import crypto from "crypto";
import { Router } from "express";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { env } from "../../config/env";
import { deleteObject, presignPutObject, s3KeyToPublicUrl } from "../../services/s3";
import { ORDER_STATUSES, Order, type OrderStatus } from "../../models/Order";

const router = Router();

type ShipmentTrackingInput = {
  sourceCity?: string;
  destinationCity?: string;
  logisticsName?: string;
  logisticsId?: string;
  awbNo?: string;
  noOfPcs?: number;
};

function sanitizeShipmentTracking(input: ShipmentTrackingInput | undefined) {
  if (!input || typeof input !== "object") return null;
  const sourceCity = typeof input.sourceCity === "string" ? input.sourceCity.trim() : "";
  const destinationCity = typeof input.destinationCity === "string" ? input.destinationCity.trim() : "";
  const logisticsName = typeof input.logisticsName === "string" ? input.logisticsName.trim() : "";
  const logisticsId = typeof input.logisticsId === "string" ? input.logisticsId.trim() : "";
  const awbNo = typeof input.awbNo === "string" ? input.awbNo.trim() : "";
  const noOfPcs = Number(input.noOfPcs);

  if (!sourceCity || !destinationCity || !logisticsName || !logisticsId || !awbNo || !Number.isFinite(noOfPcs) || noOfPcs < 1) {
    return null;
  }

  return {
    sourceCity,
    destinationCity,
    logisticsName,
    logisticsId,
    awbNo,
    noOfPcs: Number(noOfPcs),
  };
}

const STATUS_ORDER: Record<OrderStatus, number> = {
  order_received: 1,
  order_confirmed: 2,
  order_in_production: 3,
  order_shipped: 4,
  order_delivered: 5,
  order_cancelled: 6,
};

function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === "order_cancelled" || from === "order_delivered") return false;
  if (from === to) return false;
  if (to === "order_cancelled") return from === "order_received";

  const allowedNext: Partial<Record<OrderStatus, OrderStatus>> = {
    order_received: "order_confirmed",
    order_confirmed: "order_in_production",
    order_in_production: "order_shipped",
    order_shipped: "order_delivered",
  };

  return allowedNext[from] === to;
}

router.get("/orders", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const clientId = typeof req.query.clientId === "string" ? req.query.clientId : undefined;

    const query: Record<string, unknown> = {};
    if (status && ORDER_STATUSES.includes(status as OrderStatus)) query.status = status;
    if (clientId) query.clientId = clientId;

    const orders = await Order.find(query).sort({
      status: 1,
      createdAt: -1,
    });

    orders.sort((a, b) => {
      const statusRank = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (statusRank !== 0) return statusRank;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    return res.status(200).json({ orders });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/orders/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    return res.status(200).json({ order });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.patch("/orders/:id/status", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const body = req.body as {
      status?: OrderStatus;
      note?: string;
      shipmentTracking?: ShipmentTrackingInput;
    };
    const requestedStatus = body.status;
    const note = typeof body.note === "string" ? body.note.trim() : undefined;

    if (!requestedStatus || !ORDER_STATUSES.includes(requestedStatus)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (requestedStatus === "order_cancelled") {
      return res.status(400).json({ error: "Use cancel endpoint for order cancellation" });
    }

    if (!canTransition(order.status, requestedStatus)) {
      return res.status(400).json({ error: `Cannot change status from ${order.status} to ${requestedStatus}` });
    }

    const adminId = req.user?.id;
    if (!adminId) return res.status(401).json({ error: "Unauthorized" });

    if (requestedStatus === "order_shipped") {
      const shipmentTracking = sanitizeShipmentTracking(body.shipmentTracking);
      if (!shipmentTracking) {
        return res.status(400).json({
          error:
            "shipmentTracking is required for order_shipped with sourceCity, destinationCity, logisticsName, logisticsId, awbNo, and noOfPcs",
        });
      }

      const currentMeta =
        order.orderMeta && typeof order.orderMeta === "object" ? (order.orderMeta as Record<string, unknown>) : {};
      order.orderMeta = {
        ...currentMeta,
        shipmentTracking,
      };
    }

    order.status = requestedStatus;
    order.timeline.push({
      status: requestedStatus,
      changedAt: new Date(),
      changedBy: { id: adminId, role: "admin" },
      note,
    });

    await order.save();
    return res.status(200).json({ order });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.patch("/orders/:id/cancel", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const body = req.body as { note?: string };
    const note = typeof body.note === "string" ? body.note.trim() : undefined;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (order.status !== "order_received") {
      return res.status(400).json({ error: "Only order_received orders can be cancelled by admin" });
    }

    const adminId = req.user?.id;
    if (!adminId) return res.status(401).json({ error: "Unauthorized" });

    order.status = "order_cancelled";
    order.timeline.push({
      status: "order_cancelled",
      changedAt: new Date(),
      changedBy: { id: adminId, role: "admin" },
      note: note || "Cancelled by admin",
    });

    await order.save();
    return res.status(200).json({ order });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

function sanitizeInvoiceFilename(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

router.post("/orders/:id/invoices/presign", requireAuth, requireRole("admin"), async (req, res) => {
  if (!env.aws) return res.status(503).json({ error: "S3 is not configured" });
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    const body = req.body as { fileName?: string; contentType?: string };
    const contentType = body.contentType?.trim();
    const originalName = body.fileName?.trim() || "invoice.pdf";

    if (!contentType) return res.status(400).json({ error: "contentType is required" });
    if (contentType !== "application/pdf") {
      return res.status(400).json({ error: "Only PDF uploads are allowed" });
    }

    const safeName = sanitizeInvoiceFilename(originalName);
    const key = `orders/invoices/${req.params.id}/${crypto.randomUUID()}-${safeName}`;
    const uploadUrl = await presignPutObject({ key, contentType, expiresInSeconds: 120 });
    return res.status(200).json({ key, uploadUrl });
  } catch (err) {
    console.error("[orders/invoices/presign]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/orders/:id/invoices", requireAuth, requireRole("admin"), async (req, res) => {
  if (!env.aws) return res.status(503).json({ error: "S3 is not configured" });
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    const body = req.body as { key?: string; filename?: string };
    const key = body.key?.trim();
    const filename = body.filename?.trim();

    if (!key || !filename) return res.status(400).json({ error: "key and filename are required" });
    if (!key.startsWith(`orders/invoices/${req.params.id}/`)) {
      return res.status(400).json({ error: "Invalid key for this order" });
    }

    const url = s3KeyToPublicUrl(key);
    order.invoices.push({ key, filename, url, uploadedAt: new Date() } as never);
    await order.save();
    return res.status(200).json({ order });
  } catch (err) {
    console.error("[orders/invoices POST]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/orders/:id/invoices/:invoiceId", requireAuth, requireRole("admin"), async (req, res) => {
  if (!env.aws) return res.status(503).json({ error: "S3 is not configured" });
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    const invoice = order.invoices.find((inv) => String(inv._id) === req.params.invoiceId);
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });

    await deleteObject(invoice.key);
    order.invoices = order.invoices.filter((inv) => String(inv._id) !== req.params.invoiceId) as never;
    await order.save();
    return res.status(200).json({ order });
  } catch (err) {
    console.error("[orders/invoices DELETE]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
