import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/Button";
import { isClockSimulated, now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { isLocalEnv } from "@/lib/env";
import { formatCents, formatDateTime, formatPhone, toDateTimeLocal } from "@/lib/format";
import { loginAs, resetClock, setClock, simulatePayment } from "./actions";
import { DevTools } from "./DevTools";

export const metadata: Metadata = { title: "Ferramentas de teste" };

const smallButton = "min-h-11 px-4 text-sm";
const inputClass =
  "min-h-11 rounded-2xl border-2 border-peach bg-white px-3 text-base text-coffee focus:border-brand-dark focus:outline-none";

// Ferramentas de teste. Esta página só existe no ambiente de testes.
export default function DevPage() {
  if (!isLocalEnv) notFound();

  return (
    <>
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
        <Link href="/" aria-label="Chegô, página inicial">
          <Logo size={36} />
        </Link>
        <span className="rounded-full bg-peach px-4 py-2 text-sm font-bold text-brand-darker">
          Ferramentas de teste
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pb-12">
        <Suspense fallback={<p className="text-coffee-soft">Carregando...</p>}>
          <ClockSection />
          <Section title="Atalhos" hint="Tarefas agendadas, pedido de teste e recomeçar do zero.">
            <DevTools />
          </Section>
          <QuickLoginSection />
          <PendingPaymentsSection />
          <MessagesSection />
        </Suspense>
      </main>
    </>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="rounded-card bg-white p-5 shadow-sm ring-1 ring-peach">
      <h2 className="text-2xl">{title}</h2>
      <p className="mb-4 text-sm text-coffee-soft">{hint}</p>
      {children}
    </section>
  );
}

async function ClockSection() {
  const [current, simulated] = await Promise.all([now(), isClockSimulated()]);

  return (
    <Section
      title="Relógio simulado"
      hint="Muda a data e a hora que o sistema enxerga, para testar horários de loja, limite das quentinhas e café da manhã."
    >
      <p className="mb-4 text-lg">
        Agora o sistema acha que são <strong data-testid="clock-now">{formatDateTime(current)}</strong>{" "}
        {simulated ? (
          <span className="rounded-full bg-peach px-3 py-1 text-sm font-bold text-brand-darker">simulado</span>
        ) : (
          <span className="text-sm text-coffee-soft">(horário real)</span>
        )}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <form action={setClock} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Nova data e hora
            <input type="datetime-local" name="datetime" required defaultValue={toDateTimeLocal(current)} className={inputClass} />
          </label>
          <Button type="submit" className={smallButton}>Definir</Button>
        </form>
        <form action={resetClock}>
          <Button type="submit" variant="secondary" className={smallButton}>Voltar ao horário real</Button>
        </form>
      </div>
    </Section>
  );
}

type TestUser = {
  id: string;
  full_name: string;
  phone: string | null;
  role: "customer" | "merchant" | "admin" | "courier";
  blocked_at: Date | null;
  stores: string | null;
  courier: string | null;
};

const STORE_ROLE_LABELS: Record<string, string> = { owner: "dono", attendant: "atendente", courier: "entregador" };

async function QuickLoginSection() {
  await connection();
  const users = await sql<TestUser[]>`
    select p.id, p.full_name, p.phone, p.role, p.blocked_at,
      (
        select string_agg(s.name || '|' || m.role, ';' order by s.name)
        from store_members m join stores s on s.id = m.store_id
        where m.profile_id = p.id
      ) as stores,
      (select c.kind || '|' || c.status from couriers c where c.profile_id = p.id) as courier
    from profiles p
    where p.deleted_at is null
    order by p.phone`;

  const groups = [
    { title: "Admin", users: users.filter((user) => user.role === "admin") },
    { title: "Lojistas, atendentes e entregadores das lojas", users: users.filter((user) => user.role === "merchant") },
    { title: "Entregadores da rede do Chegô", users: users.filter((user) => user.role === "courier") },
    { title: "Clientes", users: users.filter((user) => user.role === "customer") },
  ];

  return (
    <Section title="Login rápido" hint="Entra como qualquer usuário de teste, sem código. Os cenários de cada um estão em docs/USUARIOS_DE_TESTE.md.">
      <div className="flex flex-col gap-5">
        {groups.map((group) => (
          <div key={group.title}>
            <h3 className="mb-2 text-lg">{group.title}</h3>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {group.users.map((user) => (
                <li key={user.id} className="flex min-w-0 items-center justify-between gap-3 rounded-2xl bg-cream px-4 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {user.full_name}
                      {user.blocked_at && <span className="ml-2 text-sm font-bold text-danger">bloqueado</span>}
                    </p>
                    <p className="text-sm text-coffee-soft">
                      {user.phone ? formatPhone(user.phone) : "sem telefone"}
                      {user.stores && ` · ${describeStores(user.stores)}`}
                    </p>
                  </div>
                  <form action={loginAs} className="shrink-0">
                    <input type="hidden" name="profileId" value={user.id} />
                    <Button type="submit" variant="secondary" className={smallButton} aria-label={`Entrar como ${user.full_name}`}>
                      Entrar como
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

/** "Loja A|owner;Loja B|courier" -> "Loja A (dono), Loja B (entregador)". */
function describeStores(encoded: string): string {
  return encoded
    .split(";")
    .map((entry) => {
      const [name, role] = entry.split("|");
      return `${name} (${STORE_ROLE_LABELS[role] ?? role})`;
    })
    .join(", ");
}

type PendingOrder = {
  id: string;
  code: string;
  customer_name: string;
  store_name: string;
  total_cents: number;
  payment_method: string;
  payment_status: string | null;
  created_at: Date;
};

async function PendingPaymentsSection() {
  await connection();
  const orders = await sql<PendingOrder[]>`
    select o.id, o.code, o.customer_name, s.name as store_name, o.total_cents, o.payment_method, o.created_at,
      (select p.status from payments p where p.order_id = o.id order by p.created_at desc limit 1) as payment_status
    from orders o
    join stores s on s.id = o.store_id
    where o.status = 'awaiting_payment'
    order by o.created_at desc`;

  return (
    <Section title="Pagamentos pendentes" hint="Faz o papel do banco: aprova, recusa ou expira o pagamento de um pedido que está aguardando.">
      {orders.length === 0 ? (
        <p className="text-coffee-soft">Nenhum pedido aguardando pagamento.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {orders.map((order) => (
            <li key={order.id} data-testid="pending-payment" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-cream px-4 py-3">
              <div>
                <p className="font-semibold">
                  {order.code} · {formatCents(order.total_cents)} · {order.payment_method === "pix" ? "Pix" : "Cartão"}
                  {order.payment_status === "declined" && <span className="ml-2 text-sm font-bold text-danger">recusado</span>}
                </p>
                <p className="text-sm text-coffee-soft">
                  {order.customer_name} na {order.store_name} · {formatDateTime(order.created_at)}
                </p>
              </div>
              <form action={simulatePayment} className="flex flex-wrap gap-2">
                <input type="hidden" name="orderId" value={order.id} />
                <Button type="submit" name="outcome" value="approve" className={smallButton}>Aprovar</Button>
                <Button type="submit" name="outcome" value="decline" variant="secondary" className={smallButton}>Recusar</Button>
                <Button type="submit" name="outcome" value="expire" variant="secondary" className={smallButton}>Expirar</Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

type OutboundMessage = {
  id: string;
  channel: "sms" | "whatsapp" | "email" | "push";
  recipient: string;
  subject: string | null;
  body: string;
  created_at: Date;
};

const CHANNEL_LABELS: Record<OutboundMessage["channel"], string> = {
  sms: "SMS",
  whatsapp: "WhatsApp",
  email: "E-mail",
  push: "Notificação",
};

async function MessagesSection() {
  await connection();
  const messages = await sql<OutboundMessage[]>`
    select id, channel, recipient, subject, body, created_at
    from outbound_messages
    order by created_at desc
    limit 50`;

  return (
    <Section title="Caixa de mensagens" hint="Tudo o que o sistema “enviou”. Aqui nada sai de verdade: nenhum SMS, WhatsApp ou e-mail real.">
      {messages.length === 0 ? (
        <p className="text-coffee-soft">Nenhuma mensagem enviada ainda.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {messages.map((message) => (
            <li key={message.id} className="rounded-2xl bg-cream px-4 py-3">
              <p className="text-sm text-coffee-soft">
                <strong className="text-coffee">{CHANNEL_LABELS[message.channel]}</strong> para {message.recipient} ·{" "}
                {formatDateTime(message.created_at)}
              </p>
              {message.subject && <p className="font-semibold">{message.subject}</p>}
              <p>{message.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
