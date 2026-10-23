import express from "express";
import helmet from "helmet";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import adminAuth from "./routes/adminAuth.js";
import events from "./routes/events.js";
import guests from "./routes/guests.js";
import access from "./routes/access.js";
import scan from "./routes/scan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use("/api/admin", adminAuth);
app.use("/api/admin", events);
app.use("/api/admin", guests);
app.use("/api/access", access);
app.use("/api/scan", scan);
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

// Serve the built React app in production (npm run build)
const dist = path.resolve(__dirname, "../../client/dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) =>
    req.method === "GET" ? res.sendFile(path.join(dist, "index.html")) : next(),
  );
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" });
});

app.listen(config.port, () =>
  console.log(`API running on http://localhost:${config.port}`),
);
