import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { isSuperAdmin, requireRole } from "@/lib/auth/session";
import { setSuperAdmin } from "./admins";
import { sql } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { publishLegal, saveSettings, toggleFlag } from "../actions";

export const metadata: Metadata = { title: "Configurações" };

const card = "flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach";
const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const LEGAL = { terms: "Termos de Uso", merchant_terms: "Termos do Lojista", privacy: "Política de Privacidade" } as const;

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  const profile = await requireRole("admin");
  const [settings, flags, documents, admins, superAdmin] = await Promise.all([
    getSettings(),
    sql<{ key: string; enabled: boolean; description: string }[]>`select key, enabled, description from feature_flags order by key`,
    sql<{ type: keyof typeof LEGAL; version: number; title: string; content: string }[]>`
      select distinct on (type) type, version, title, content from legal_documents
      where published_at is not null order by type, version desc`,
    sql<{ id: string; name: string; email: string | null; is_super_admin: boolean }[]>`
      select id, full_name as name, email, is_super_admin from profiles where role = 'admin' and deleted_at is null order by is_super_admin desc, full_name`,
    isSuperAdmin(profile.id),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-3xl">Configurações</h1>

      <section className={card} data-testid="admins">
        <h2 className="text-xl">Administradores</h2>
        <p className="text-sm text-coffee-soft">
          Super admin faz as ações globais críticas: suspender e excluir contas, anúncios, ocultar avaliações e corrigir notas. Admin comum vê o painel e atende o dia a dia.
        </p>
        <ul className="flex flex-col gap-2">
          {admins.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-cream px-3 py-2 text-sm">
              <span><strong>{item.name}</strong>{item.email && <span className="text-coffee-soft"> · {item.email}</span>} · {item.is_super_admin ? "Super admin" : "Admin"}{item.id === profile.id && " (você)"}</span>
              {superAdmin && item.id !== profile.id && (
                <ActionForm action={setSuperAdmin} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={item.id} /><input type="hidden" name="grant" value={item.is_super_admin ? "0" : "1"} />
                  <SubmitButton variant="secondary" className="min-h-11 px-3 text-xs">{item.is_super_admin ? "Tirar super admin" : "Tornar super admin"}</SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      </section>

      <ActionForm action={saveSettings} className={card}>
        <h2 className="text-xl">Taxas e prazos</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Taxa do Chegô por pedido concluído (R$)" name="order_fee_cents" inputMode="decimal" defaultValue={money(settings.order_fee_cents)} hint="Cobrada da loja. Mudar vale só para os pedidos concluídos depois." />
          <Field label="O expediente vira às (hora)" name="business_day_cutoff_hour" type="number" min={0} max={12} defaultValue={settings.business_day_cutoff_hour} hint="Pedidos concluídos antes desta hora contam para o dia anterior." />
          <Field label="Prazo para a loja pagar as taxas (dias)" name="fee_due_days" type="number" min={1} max={30} defaultValue={settings.fee_due_days} />
          <Field label="Pix das taxas vale por (horas)" name="fee_pix_expiration_hours" type="number" min={1} max={168} defaultValue={settings.fee_pix_expiration_hours} />
          <Field label="Taxa de serviço por pedido (R$)" name="service_fee_cents" inputMode="decimal" defaultValue={money(settings.service_fee_cents)} hint="Só para pedidos pagos pelo app (hoje desligado)." />
          <Field label="Comissão padrão de lojas novas (%)" name="default_commission_rate" inputMode="decimal" defaultValue={(settings.default_commission_rate * 100).toFixed(1).replace(".", ",")} hint="Só para pedidos pagos pelo app (hoje desligado)." />
          <Field label="Pix do pedido expira em (minutos)" name="pix_expiration_minutes" type="number" min={1} defaultValue={settings.pix_expiration_minutes} hint="Só para pedidos pagos pelo app." />
          <Field label="Avaliar até (dias depois da entrega)" name="review_window_days" type="number" min={1} defaultValue={settings.review_window_days} />
          <Field label="Alerta forte sem aceite (minutos)" name="acceptance_alert_minutes" type="number" min={1} defaultValue={settings.acceptance_alert_minutes} />
          <Field label="Recusa automática sem aceite (minutos)" name="auto_reject_minutes" type="number" min={1} defaultValue={settings.auto_reject_minutes} />
          <Field label="Parte do entregador na taxa de entrega (%)" name="courier_fee_percent" type="number" min={0} max={100} defaultValue={settings.courier_fee_percent} hint="Vale para as entregas feitas pela rede do Chegô. O resto fica com a plataforma." />
          <Field label="Indique e ganhe: cupom de quem foi indicado (R$)" name="referral_referred_cents" inputMode="decimal" defaultValue={money(settings.referral_referred_cents)} />
          <Field label="Indique e ganhe: cupom de quem indicou (R$)" name="referral_referrer_cents" inputMode="decimal" defaultValue={money(settings.referral_referrer_cents)} />
        </div>
        <SubmitButton className="self-start">Salvar configurações</SubmitButton>
      </ActionForm>

      <section className={card}>
        <h2 className="text-xl">Recursos</h2>
        <ul className="flex flex-col gap-2">
          {flags.map((flag) => (
            <li key={flag.key} data-testid="admin-flag" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-cream px-3 py-2">
              <span>{flag.description}<span className="block text-xs text-coffee-soft">{flag.key}</span></span>
              <form action={toggleFlag}>
                <input type="hidden" name="key" value={flag.key} />
                <Button type="submit" variant={flag.enabled ? "primary" : "secondary"} className="min-h-11 px-4 text-sm" aria-pressed={flag.enabled} aria-label={`${flag.description}: ${flag.enabled ? "ligado" : "desligado"}`}>
                  {flag.enabled ? "Ligado" : "Desligado"}
                </Button>
              </form>
            </li>
          ))}
        </ul>
        <p className="text-sm text-coffee-soft">O modo manutenção é por cidade e fica em Cadastros.</p>
      </section>

      <section className={card}>
        <h2 className="text-xl">Termos e política</h2>
        <p className="text-sm text-coffee-soft">Ao publicar uma versão nova, todo usuário precisa aceitar de novo no próximo acesso. O aceite fica gravado com data e versão.</p>
        <ul className="text-sm">
          {documents.map((document) => <li key={document.type} data-testid="legal-version">{LEGAL[document.type]}: versão {document.version}</li>)}
        </ul>
        <ActionForm action={publishLegal} resetOnSuccess className="flex flex-col gap-3 rounded-2xl border-2 border-dashed border-peach p-3">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Documento
            <select name="type" defaultValue="terms" className={inputClass}>
              {Object.entries(LEGAL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <Field label="Título" name="title" required maxLength={120} defaultValue="Termos de Uso" />
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Texto completo
            <textarea name="content" required minLength={20} rows={8} className={`${inputClass} py-3 font-normal`} />
          </label>
          <SubmitButton variant="secondary" className="self-start">Publicar nova versão</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
