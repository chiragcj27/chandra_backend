import { Router } from "express";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
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

export default router;
