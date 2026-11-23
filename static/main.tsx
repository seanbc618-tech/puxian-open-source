/**
 * Client-only entry for the Capacitor `webDir` package.
 * Mounts the landing page and score editor without TanStack Start, Nitro, auth, or the preview bridge.
 * See docs/static-mobile-build.md.
 */
import { Component, type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import { HomeApp } from "@/components/home-landing";
import appCss from "@/styles.css?url";

const root = document.getElementById("root");
if (!root) {
  throw new Error("静态页面缺少 #root。");
}

function markReady() {
  document.documentElement.dataset.puxianReady = "1";
}

function fillRecovery(host: HTMLElement) {
  if (host.childElementCount > 0) return;
  markReady();
  host.innerHTML = `<div data-app-error role="alert" style="max-width:32rem;margin:3rem auto;padding:2rem;text-align:center;background:#f7f3ea;border:1px solid #ddd6c8;border-radius:1rem;color:#1c1916;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Noto Sans SC',sans-serif">
    <h1 style="font-size:1.125rem;font-weight:500">谱线遇到了问题</h1>
    <p style="margin-top:0.75rem;font-size:0.875rem;line-height:1.75;color:#6f675e">刚才的操作没能完成。已经写好的谱还在本机，刷新后可以继续。</p>
    <button type="button" style="margin-top:1.25rem;min-height:44px;padding:0 1rem;border-radius:999px;border:0;background:#a44825;color:#fff;font-size:0.95rem">刷新页面</button>
  </div>`;
  host.querySelector("button")?.addEventListener("click", () => window.location.reload());
}

class ReadyMark extends Component<{ children: ReactNode }> {
  componentDidMount() {
    markReady();
  }
  render() {
    return this.props.children;
  }
}

const link = document.createElement("link");
link.rel = "stylesheet";
link.href = appCss;
const ready = new Promise<void>((resolve, reject) => {
  link.onload = () => resolve();
  link.onerror = () => reject(new Error("谱线样式没有加载。"));
});
document.head.append(link);
await ready;

try {
  createRoot(root, {
    onUncaughtError() {
      markReady();
      queueMicrotask(() => fillRecovery(root));
    },
    onCaughtError() {
      markReady();
    },
  }).render(
    <StrictMode>
      <AppErrorBoundary>
        <ReadyMark>
          <HomeApp />
        </ReadyMark>
      </AppErrorBoundary>
    </StrictMode>,
  );
  markReady();
} catch {
  fillRecovery(root);
}

const watch = new MutationObserver(() => {
  if (document.documentElement.dataset.puxianReady === "1" && root.childElementCount === 0) {
    fillRecovery(root);
  }
});
watch.observe(root, { childList: true });
