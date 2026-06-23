require("dotenv/config");
const { defineConfig } = require("prisma/config");

// Safe fallback during compile/build time on Vercel
const databaseUrl = process.env.DATABASE_URL || "postgresql://dummy_user:dummy_password@localhost:5432/dummy_db";

module.exports = defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: databaseUrl,
  },
});
