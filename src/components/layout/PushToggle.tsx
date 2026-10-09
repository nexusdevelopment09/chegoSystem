"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

type State = "unsupported" | "off" | "on" | "denied" | "working";

/** Turns browser notifications on or off for this device. */
export function PushToggle() {
  const [state, setState] = useState<State>("working");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setState("denied");
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!cancelled) setState(subscription ? "on" : "off");
    })().catch(() => !cancelled && setState("unsupported"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn() {
    setState("working");
    try {
      if ((await Notification.requestPermission()) !== "granted") return setState("denied");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      await fetch("/api/push", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(subscription) });
      setState("on");
    } catch {
      setState("off");
    }
  }

  async function turnOff() {
    setState("working");
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }) });
        await subscription.unsubscribe();
      }
    } finally {
      setState("off");
    }
  }

  if (state === "unsupported") {
    return <p className="text-sm text-coffee-soft">Este navegador não mostra notificações do app. Elas continuam aparecendo no sino.</p>;
  }
  if (state === "denied") {
    return <p className="text-sm text-coffee-soft">As notificações estão bloqueadas neste navegador. Libere nas configurações do site para receber os avisos do pedido.</p>;
  }
  return state === "on" ? (
    <Button type="button" variant="secondary" onClick={turnOff}>Desligar notificações neste aparelho</Button>
  ) : (
    <Button type="button" disabled={state === "working"} onClick={turnOn}>Ligar notificações neste aparelho</Button>
  );
}
