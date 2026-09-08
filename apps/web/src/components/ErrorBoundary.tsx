import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catches render-time crashes anywhere below it and shows a recoverable card
 * instead of a blank page. It never surfaces the raw error text to the user.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  override state = { crashed: false };

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Dev console only; nothing user-facing, nothing sent anywhere.
    console.error("UI error boundary caught:", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="mx-auto max-w-md space-y-3 px-4 py-16 text-center">
        <h1 className="text-lg font-semibold">Something went wrong on this page</h1>
        <p className="text-sm text-neutral-600">
          Your work is saved on the server. Reloading usually fixes it.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Reload
        </button>
      </div>
    );
  }
}
