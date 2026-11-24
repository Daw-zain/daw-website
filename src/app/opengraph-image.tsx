import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Daw Zainelabideen – Project Management Training & Consulting";

export default function OG() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "linear-gradient(135deg,#0B1E30 0%,#102A43 55%,#1769AA 100%)", padding: 72, color: "white", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, width: 72, height: 72, borderRadius: 16, background: "#FFFFFF", padding: 14 }}>
            <div style={{ width: 12, height: 18, background: "#1769AA", borderRadius: 3 }} />
            <div style={{ width: 12, height: 30, background: "#102A43", borderRadius: 3 }} />
            <div style={{ width: 12, height: 44, background: "#C5A15A", borderRadius: 3 }} />
          </div>
          <div style={{ fontSize: 34, fontWeight: 700 }}>Daw Zainelabideen</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.1 }}>Develop Your Skills.</div>
          <div style={{ fontSize: 54, fontWeight: 800, lineHeight: 1.1 }}>Deliver Your Projects with Confidence.</div>
          <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.1, color: "#C5A15A" }}>Achieve Sustainable Value.</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, color: "rgba(255,255,255,0.8)" }}>
          <span>Project Management Trainer & Consultant</span>
          <span>PMP® · PMI-RMP® · PMI-ACP®</span>
        </div>
      </div>
    ),
    size,
  );
}
