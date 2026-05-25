import express from "express";
import cors from "cors";

import docsRouter from "./openapi/router";
import routes from "./routes";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger UI at GET /docs (raw spec at GET /docs/openapi.json). Mounted before
// the main router so it's never shadowed by a wildcard route.
app.use("/", docsRouter);

app.use("/", routes);

export default app;

