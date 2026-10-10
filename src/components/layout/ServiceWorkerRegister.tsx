"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    // Service workers só rodam em HTTPS ou em localhost, então isto não faz nada
    // quando o app é aberto no celular pelo IP do computador.
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  }, []);

  return null;
}
