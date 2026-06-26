import { Component } from "react";

// Catches render-time errors anywhere below it and shows a recoverable fallback
// instead of a blank white screen. Styled inline so it works even if the app's
// stylesheet never mounted.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // Surface in console for debugging; data in localStorage is untouched.
    console.error("FitLog crashed:", error, info);
  }
  reset = () => this.setState({ error: null });
  render() {
    if (this.state.error) {
      // Compact fallback: a single view/card crashed, not the whole app. Keep the
      // shell (nav/header) alive so the user can move to another tab.
      if (this.props.compact) {
        return (
          <div style={{ margin: 16, padding: 20, borderRadius: 14, background: "#1a1b21", color: "#e7e7ea", fontFamily: "Inter, system-ui, sans-serif", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>◍</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{this.props.label || "This section"} hit an error</div>
            <p style={{ color: "#9a9aa2", fontSize: 13, lineHeight: 1.5, margin: "0 0 14px" }}>
              Your data is safe. Try again, or switch tabs.
            </p>
            <button onClick={this.reset} style={{ background: "#8fd989", color: "#0e0f13", border: "none", borderRadius: 10, padding: "9px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Try again
            </button>
            <p style={{ color: "#5a5a62", fontSize: 11, marginTop: 12, wordBreak: "break-word" }}>{String(this.state.error?.message || this.state.error)}</p>
          </div>
        );
      }
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#0e0f13", color: "#e7e7ea", fontFamily: "Inter, system-ui, sans-serif", textAlign: "center" }}>
          <div style={{ maxWidth: 360 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>◍</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>Something glitched</h2>
            <p style={{ color: "#9a9aa2", lineHeight: 1.5, fontSize: 14, margin: "0 0 20px" }}>
              The app hit an unexpected error, but your data is safe — it's stored on your device. Reloading usually fixes it.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{ background: "#8fd989", color: "#0e0f13", border: "none", borderRadius: 12, padding: "12px 24px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
            >
              Reload FitLog
            </button>
            <p style={{ color: "#5a5a62", fontSize: 11, marginTop: 16, wordBreak: "break-word" }}>{String(this.state.error?.message || this.state.error)}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
