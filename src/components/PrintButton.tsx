"use client";

import { DownloadIcon } from "./Icons";

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn btn-primary">
      <DownloadIcon className="h-5 w-5" />
      {label}
    </button>
  );
}
