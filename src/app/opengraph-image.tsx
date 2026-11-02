import { ImageResponse } from "next/og";

export const alt = "Chaperone: your agent shops, Chaperone holds the money.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  const lines = Array.from({ length: 9 }, (_, i) => i);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#ECE9E3", color: "#121211", position: "relative" }}>
        <svg width="1200" height="630" viewBox="0 0 1200 630" style={{ position: "absolute", left: 0, top: 0 }}>
          {lines.map((i) => (
            <path
              key={i}
              d={`M-20 ${330 + i * 22} C 240 ${250 + i * 18}, 420 ${430 + i * 14}, 700 ${330 + i * 20} S 1040 ${250 + i * 24}, 1220 ${320 + i * 20}`}
              fill="none"
              stroke="#121211"
              strokeOpacity={i === 4 ? 0.7 : 0.14}
              strokeWidth={i === 4 ? 4 : 1.5}
            />
          ))}
        </svg>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="64" height="64" viewBox="0 0 32 32">
            <path d="M24.43 8.93A11 11 0 1 0 24.43 23.07" fill="none" stroke="#121211" strokeWidth="5" strokeLinecap="round" />
            <circle cx="16" cy="16" r="4.25" fill="#E8572A" />
          </svg>
          <div style={{ fontSize: 44, fontWeight: 600, letterSpacing: -2 }}>chaperone</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 96, fontWeight: 600, letterSpacing: -5, lineHeight: 0.95 }}>Your agent shops.</div>
          <div style={{ fontSize: 96, fontWeight: 600, letterSpacing: -5, lineHeight: 0.95, color: "#E8572A" }}>We hold the money.</div>
          <div style={{ marginTop: 28, fontSize: 26, color: "#5B5852", fontFamily: "monospace" }}>
            [ every purchase is a PayPal hold · checked before capture ]
          </div>
        </div>
      </div>
    ),
    size,
  );
}
