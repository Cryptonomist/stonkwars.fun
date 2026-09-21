"use client";

/* A WIDGET THAT MAY FAIL WITHOUT TAKING THE PAGE WITH IT.
 *
 * The layout mounts several things no page depends on: the call-out bar, the
 * toasts about your fights, the command palette, the X sheet. They sit outside
 * every page's error boundary (app/error.tsx only catches the page), so a
 * throw in any one of them would have blanked every route on the site with
 * Next's white "Application error" screen. Wrapped in this, the widget goes
 * quiet instead: it renders nothing, the error goes to the console for whoever
 * fixes it, and the fight on screen carries on.
 *
 * Only for the optional. Navigation, the page and the footer are not wrapped:
 * if those break, app/global-error.tsx says so. */

import { Component, type ReactNode } from "react";

export class Quiet extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`${this.props.name} failed and was switched off for this page view`, error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
