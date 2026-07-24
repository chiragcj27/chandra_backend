import { type NextFunction, type Request, type Response } from "express";

import { verifyAccessToken, type JwtRole } from "../services/jwt";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.header("Authorization");
  const match = authHeader?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      role: payload.role,
      username: payload.username,
      clientName: payload.clientName,
      email: payload.email,
    };
    return next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

export function requireRole(role: JwtRole | JwtRole[]) {
  const allowedRoles = Array.isArray(role) ? role : [role];
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (!allowedRoles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    return next();
  };
}

