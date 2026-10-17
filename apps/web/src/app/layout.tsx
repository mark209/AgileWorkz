import { ReactNode } from "react";
import { AuthProvider } from "../lib/auth-context";
import { MainNavigation } from "../components/shared/main-navigation";
import "./globals.css";

export const metadata = {
  title: "AgileWorks HVAC ERP",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <AuthProvider>
          <MainNavigation>{children}</MainNavigation>
        </AuthProvider>
      </body>
    </html>
  );
}
