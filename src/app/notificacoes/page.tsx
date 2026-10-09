import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { markNotificationsRead } from "@/app/perfil/actions";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { Button } from "@/components/ui/Button";
import { requireUser } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Notificações" };

export default function NotificationsPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10">
        <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
          <Notifications />
        </Suspense>
      </main>
    </>
  );
}

async function Notifications() {
  const profile = await requireUser();
  // Read as the user: Row Level Security returns only their own notifications.
  const notifications = await withUser(profile.id, (tx) => tx<{ id: string; title: string; body: string; link: string | null; read_at: Date | null; created_at: Date }[]>`
    select id, title, body, link, read_at, created_at from notifications order by created_at desc limit 60`);
  const unread = notifications.filter((notification) => !notification.read_at).length;

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl">Notificações</h1>
        {unread > 0 && (
          <form action={markNotificationsRead}>
            <Button type="submit" variant="secondary" className="min-h-11 px-4 text-sm">Marcar todas como lidas</Button>
          </form>
        )}
      </header>
      <p className="text-coffee-soft" data-testid="unread-count">
        {unread === 0 ? "Você está em dia." : `${unread} não lida${unread > 1 ? "s" : ""}.`}
      </p>

      {notifications.length === 0 && <p className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nenhuma notificação por aqui.</p>}
      <ul className="flex flex-col gap-2">
        {notifications.map((notification) => {
          const content = (
            <>
              <p className={notification.read_at ? "font-semibold" : "font-bold"}>
                {!notification.read_at && <span className="mr-2 inline-block size-2 rounded-full bg-brand align-middle" aria-label="Não lida" />}
                {notification.title}
              </p>
              {notification.body && <p className="text-sm">{notification.body}</p>}
              <p className="text-xs text-coffee-soft">{formatDateTime(notification.created_at)}</p>
            </>
          );
          return (
            <li key={notification.id} data-testid="notification" className={`rounded-card p-4 ring-1 ring-peach ${notification.read_at ? "bg-white" : "bg-peach/60"}`}>
              {notification.link ? <Link href={notification.link} className="block">{content}</Link> : content}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
