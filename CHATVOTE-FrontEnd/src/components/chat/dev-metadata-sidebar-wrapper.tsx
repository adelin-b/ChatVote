"use client";

import dynamic from "next/dynamic";

const DevMetadataSidebar =
  process.env.NODE_ENV === "development"
    ? dynamic(() => import("./dev-metadata-sidebar"), { ssr: false })
    : () => null;

export default function DevMetadataSidebarWrapper() {
  return <DevMetadataSidebar />;
}
