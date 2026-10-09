"use client";

import { useEffect } from "react";

/** Opens the browser's print dialog as soon as the ticket is on screen. */
export function PrintOnLoad() {
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
