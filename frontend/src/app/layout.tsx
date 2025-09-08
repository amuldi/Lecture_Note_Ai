// frontend/src/app/layout.tsx
import "../styles/globals.css";

export const metadata = { title: "Lecture Notes AI" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-white text-gray-900">{children}</body>
    </html>
  );
}