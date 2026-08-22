import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI configuration (Prisma 7+).
 *
 * Two breaking changes from Prisma 6 are handled here:
 *
 * 1. Connection URLs no longer live in schema.prisma (`url` / `directUrl` were
 *    removed). Migrations and introspection read the URL from this file; the
 *    runtime client is handed its own in src/lib/prisma.ts.
 * 2. The CLI no longer loads .env by itself, hence the dotenv import above.
 *
 * DIRECT_URL is preferred for CLI work: a pooled connection (Supabase/Neon
 * pgBouncer) cannot hold the advisory locks migrations need. DATABASE_URL is
 * the fallback for a plain local Postgres where the two are the same.
 */
const migrationUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!migrationUrl) {
  throw new Error("Set DIRECT_URL (preferred) or DATABASE_URL before running Prisma commands.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: migrationUrl },
  migrations: { seed: "tsx prisma/seed.ts" },
});
