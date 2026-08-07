import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://onlinejudge:onlinejudge@localhost:5433/onlinejudge",
  },
  // Django 框架表不进新后端，introspect 时直接排除
  tablesFilter: ["!django_*", "!auth_*"],
})
