import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  onError?: (error: Error, info: ErrorInfo) => void;
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    this.props.onError?.(error, info);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      const { fallback } = this.props;
      return typeof fallback === "function"
        ? fallback(this.state.error, this.reset)
        : fallback;
    }
    return this.props.children;
  }
}

export function PanelError({ reset }: { reset?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <p className="text-xs mono" style={{ color: "var(--red)" }}>failed to load</p>
      {reset && <button onClick={reset} className="text-xs mono text-accent hover:underline">retry</button>}
    </div>
  );
}

export function InlineError() {
  return <span className="text-xs mono" style={{ color: "var(--red)" }} role="alert">failed to render</span>;
}
