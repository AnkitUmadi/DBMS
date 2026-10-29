// src/app/layout.jsx
// FinShield — Next.js App Router Root Layout (Server Component)
// Implements TRD Section 2.2 & UI/UX Specification Section 4.1

import React from "react";

export const metadata = {
  title:
    "FinShield — Deterministic Polyglot Financial Resilience & Debt Mitigation Engine",
  description:
    "Next.js App Router + PostgreSQL 18 + MongoDB 8.2 + pgvector Semantic Recovery Playbooks",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
        <script src="https://cdn.tailwindcss.com"></script>
        <style
          dangerouslySetInnerHTML={{
            __html: `
              body {
                font-family: 'Inter', system-ui, -apple-system, sans-serif;
                background-color: #F8FAFC;
                color: #0F172A;
              }
              .mono-num {
                font-family: 'JetBrains Mono', monospace;
                font-variant-numeric: tabular-nums;
              }
            `,
          }}
        />
      </head>
      <body className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}
