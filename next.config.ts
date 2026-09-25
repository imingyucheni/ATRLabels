import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "exceljs", "pdf-lib"],
};

export default nextConfig;
