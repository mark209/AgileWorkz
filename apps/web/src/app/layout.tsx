import { ReactNode } from "react";
import { AuthProvider } from "../lib/auth-context";
import { MainNavigation } from "../components/shared/main-navigation";
import { OutcomeProvider } from "../components/shared/outcome-provider";
import "./globals.css";

export const metadata = {
  title: "AgileWorks HVAC ERP",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <AuthProvider>
          <OutcomeProvider><MainNavigation>{children}</MainNavigation></OutcomeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
