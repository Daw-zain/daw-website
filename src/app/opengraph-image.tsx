import { readFileSync } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Al Daleel Raqamee – Training & Consulting";

export default function OG() {
  const logo = `data:image/png;base64,${readFileSync(path.join(process.cwd(), "public/images/brand/aldaleel-logo-white.png")).toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "linear-gradient(135deg,#040F1F 0%,#06152A 55%,#3C439B 100%)", padding: 72, color: "white", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} width={114} height={80} alt="" />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 36, fontWeight: 700 }}>Al Daleel Raqamee</div>
            <div style={{ fontSize: 26, color: "#E23337", fontWeight: 700 }}>Training & Consulting</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.1 }}>Develop Your Skills.</div>
          <div style={{ fontSize: 54, fontWeight: 800, lineHeight: 1.1 }}>Deliver Your Projects with Confidence.</div>
          <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.1, color: "#E23337" }}>Achieve Sustainable Value.</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, color: "rgba(255,255,255,0.8)" }}>
          <span>PMI® Authorized Training Partner</span>
          <span>PMP® · PMI-RMP® · PMI-ACP® · CAPM®</span>
        </div>
      </div>
    ),
    size,
  );
}