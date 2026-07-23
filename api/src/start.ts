import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

const envCandidates = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "..", ".env"),
];

for (const envPath of envCandidates) {
  if (!existsSync(envPath)) continue;
  loadEnv({ path: envPath, override: false });
}

await import("./index.js");
