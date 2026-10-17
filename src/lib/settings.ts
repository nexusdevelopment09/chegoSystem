import "server-only";
import { cache } from "react";
import { sql } from "@/lib/db";

/** Configurações da plataforma que o admin pode mudar, com os valores padrão. */
const DEFAULTS = {
  service_fee_cents: 99,
  default_commission_rate: 0.1,
  pix_expiration_minutes: 15,
  acceptance_alert_minutes: 8,
  auto_reject_minutes: 15,
  review_window_days: 7,
  referral_referred_cents: 500,
  referral_referrer_cents: 500,
  // Parte da taxa de entrega que fica com o entregador da rede do Chegô (0 a 100).
  courier_fee_percent: 100,
  // Taxa do Chegô cobrada da loja por pedido concluído, em centavos. Mudar vale só
  // para os pedidos concluídos depois: cada lançamento guarda o valor da época.
  order_fee_cents: 50,
  // Hora (0 a 12) em que o dia de expediente vira: pedidos antes disso contam para o dia anterior.
  business_day_cutoff_hour: 5,
  // Dias depois do fechamento para a loja pagar as taxas.
  fee_due_days: 3,
  // Horas até o Pix das taxas expirar.
  fee_pix_expiration_hours: 24,
};

export type Settings = typeof DEFAULTS;
export const SETTING_KEYS = Object.keys(DEFAULTS) as (keyof Settings)[];

export const getSettings = cache(async (): Promise<Settings> => {
  const rows = await sql<{ key: string; value: unknown }[]>`
    select key, value from platform_settings where key = any(${SETTING_KEYS})`;
  const settings = { ...DEFAULTS };
  for (const row of rows) {
    if (typeof row.value === "number") settings[row.key as keyof Settings] = row.value;
  }
  return settings;
});

export const getFeatureFlag = cache(async (key: string): Promise<boolean> => {
  const [row] = await sql<{ enabled: boolean }[]>`select enabled from feature_flags where key = ${key}`;
  return row?.enabled ?? false;
});
