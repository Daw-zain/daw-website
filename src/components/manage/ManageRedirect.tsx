"use client";

import { useEffect } from "react";
import { withBase } from "@/lib/env-public";
import { Spinner } from "@/components/exams/ExamShell";

/** an old address that moved into the admin dashboard */
export function ManageRedirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(withBase(to));
  }, [to]);
  return (
    <div className="py-24">
      <Spinner />
    </div>
  );
}
