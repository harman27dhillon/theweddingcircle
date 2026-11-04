import { Component, type ReactNode } from "react";

type State = { error: Error | null };

export class BootBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main data-app-ready="" style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24, background: "#f4efe8", color: "#1c1412", textAlign: "center", fontFamily: "Georgia, serif" }}>
        <h1 style={{ fontSize: "1.6rem", margin: 0 }}>The Wedding Circle</h1>
        <p style={{ margin: 0, maxWidth: "24rem" }}>Something went wrong while opening this page.</p>
        <p style={{ margin: 0, maxWidth: "24rem", fontFamily: "sans-serif", fontSize: "0.9rem" }}>{this.state.error.message}</p>
        <button
          type="button"
          style={{ minHeight: 44, padding: "0 16px", borderRadius: 999, border: 0, background: "#8c2f39", color: "#fffaf4" }}
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </main>
    );
  }
}
