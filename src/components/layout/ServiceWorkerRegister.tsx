"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    // Service workers only run on HTTPS or localhost, so this is a no-op
    // when the app is opened on a phone through the computer's IP.
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  }, []);

  return null;
}
