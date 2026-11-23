import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import appCss from "../styles.css?url";

const APP_NAME = "谱线";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: APP_NAME },
      { name: "description", content: "在浏览器里写简谱、五线谱、和弦谱和六线谱，用卷帘跟奏练习。谱存本机；识谱才上传。" },
      { name: "theme-color", content: "#f7f3ea" },
      { property: "og:site_name", content: APP_NAME },
      { property: "og:title", content: APP_NAME },
      { property: "og:description", content: "在浏览器里写简谱、五线谱、和弦谱和六线谱，用卷帘跟奏练习。谱存本机；识谱才上传。" },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "zh_CN" },
      { property: "og:url", content: "https://818189.xyz/" },
      { property: "og:image", content: "https://818189.xyz/og-image.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "谱线：让旋律，落在纸上。简谱、五线谱、和弦谱、六线谱与卷帘跟奏。" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: APP_NAME },
      { name: "twitter:description", content: "在浏览器里写简谱、五线谱、和弦谱和六线谱，用卷帘跟奏练习。谱存本机；识谱才上传。" },
      { name: "twitter:image", content: "https://818189.xyz/og-image.png" },
    ],
    links: [
      { rel: "canonical", href: "https://818189.xyz/" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  component: () => (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
