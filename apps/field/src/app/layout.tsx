import { ReactNode } from "react";
import { AuthProvider } from "../lib/auth-context";

export const metadata = {
  title: "AgileWorks Field",
  manifest: "/manifest.json",
};

export const viewport = {
  themeColor: "#0e7a68",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Phase 4 Operations Frontend — a global box-sizing reset. Without
            it, any element styled with width:100% plus padding (several
            already exist, e.g. login's own inputs) overflows its container
            by exactly the padding amount — invisible at desktop width where
            there's slack, but a real horizontal-scroll bug on a phone.
            One rule here fixes the whole class of bug app-wide instead of
            adding boxSizing to every inline style object individually. */}
        <style>{"*, *::before, *::after { box-sizing: border-box; }"}</style>
      </head>
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
