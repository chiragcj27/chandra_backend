import "express";

declare module "express-serve-static-core" {
  interface Request {
    user?: {
      id: string;
      role: "admin" | "client";
      username?: string;
    };
  }
}

