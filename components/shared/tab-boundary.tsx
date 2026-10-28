'use client';

import { Component, type ReactNode } from 'react';

// One page of the dashboard that breaks (for example on data it did not expect) shows its error
// here instead of blanking the whole dashboard; the other pages keep working.
export class TabBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`The ${this.props.name} page failed:`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm">
        <div className="font-semibold">This page could not be shown.</div>
        <p className="mt-1 text-muted-foreground">{this.state.error.message}</p>
        <p className="mt-1 text-muted-foreground">The other pages still work. Press Refresh at the top to try this page again.</p>
      </div>
    );
  }
}
