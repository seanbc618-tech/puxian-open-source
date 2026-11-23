import type { CapacitorConfig } from "@capacitor/cli";

/**
 * iOS shell around the milestone A static client.
 * `webDir` is `dist-static` (has index.html). Never Nitro `.output` or `.vercel`.
 * Do not set `server.url`: that loads a dev or preview host instead of the package.
 */
const config: CapacitorConfig = {
  appId: "tech.seanbc618.puxian",
  appName: "谱线",
  webDir: "dist-static",
  ios: {},
  server: {
    iosScheme: "capacitor",
  },
};

export default config;
