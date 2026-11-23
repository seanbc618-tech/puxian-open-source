import { Component, type ErrorInfo, type ReactNode } from "react";
import { quiet, solid } from "./ui/styles";

type Props = {
  children: ReactNode;
  /** Short Chinese label for where the crash happened, e.g. 谱面. */
  label?: string;
  onReset?: () => void;
};

type State = { error: Error | null };

/**
 * Keeps #root occupied after a render crash so the boot splash
 * ("正在打开谱线…") cannot come back. Cream paper, Chinese copy.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(this.props.label ? `谱线（${this.props.label}）出错` : "谱线出错", error, info.componentStack);
  }

  reset = () => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    const where = this.props.label ?? "谱线";
    return (
      <div
        data-app-error
        role="alert"
        className="mx-auto max-w-lg rounded-2xl border border-line bg-paper px-5 py-8 text-center text-ink"
      >
        <h2 className="text-lg font-medium">{where}遇到了问题</h2>
        <p className="mt-3 text-sm leading-7 text-muted">
          刚才的操作没能完成。已经写好的谱还在本机，可以再试一次，或换一个视图。
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button type="button" className={solid} onClick={this.reset}>
            再试一次
          </button>
          <button type="button" className={quiet} onClick={() => window.location.assign(window.location.pathname || "/")}>
            返回主页
          </button>
        </div>
      </div>
    );
  }
}
