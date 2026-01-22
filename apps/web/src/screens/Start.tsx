import React from "react";

export default function TopBarWithIntro({ title }: { title?: string }) {
  return (
    <div style={{ padding: 12, border: "1px solid #555", color: "#fff" }}>
      TopBarWithIntro minimal: {title || "—"}
    </div>
  );
}
