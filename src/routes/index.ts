import { Router } from "express";

import healthRouter from "./health";
import adminRouter from "./admin";
import authRouter from "./auth";
import bannersRouter from "./banners";
import categoriesRouter from "./categories";

const routes = Router();

routes.use(healthRouter);
routes.use("/admin", adminRouter);
routes.use("/auth", authRouter);
routes.use(bannersRouter);
routes.use(categoriesRouter);

export default routes;

