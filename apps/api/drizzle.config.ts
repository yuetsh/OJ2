import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://onlinejudge:onlinejudge@localhost:5433/onlinejudge",
  },
})
