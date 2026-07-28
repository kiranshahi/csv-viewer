import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  output: isGitHubPages ? "export" : undefined,
  basePath: isGitHubPages ? "/csv-viewer" : "",
  assetPrefix: isGitHubPages ? "/csv-viewer/" : "",
  trailingSlash: isGitHubPages,
};

export default nextConfig;
