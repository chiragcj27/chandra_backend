import { Router } from "express";

import healthRouter from "./health";
import adminRouter from "./admin";
import authRouter from "./auth";
import bannersRouter from "./banners";
import categoriesRouter from "./categories";
import clientsRouter from "./clients";
import ordersRouter from "./orders";

const routes = Router();

routes.use(healthRouter);
routes.use("/admin", adminRouter);
routes.use("/auth", authRouter);
routes.use(bannersRouter);
routes.use(categoriesRouter);
routes.use(clientsRouter);
routes.use(ordersRouter);

export default routes;

