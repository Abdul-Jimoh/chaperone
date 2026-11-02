import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#121211" }}>
        <svg width="120" height="120" viewBox="0 0 32 32">
          <path d="M24.43 8.93A11 11 0 1 0 24.43 23.07" fill="none" stroke="#ECE9E3" strokeWidth="5" strokeLinecap="round" />
          <circle cx="16" cy="16" r="4.25" fill="#E8572A" />
        </svg>
      </div>
    ),
    size,
  );
}
