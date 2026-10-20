import "server-only";
import { sql } from "@/lib/db";

export const AUDIT_MODULES: Record<string, string> = {
  acesso: "Entrada e acesso",
  pedidos: "Pedidos",
  cardapio: "Cardápio",
  menu: "Cardápio (planilha e reajuste)",
  estoque: "Estoque",
  mesas: "Mesas e balcão",
  equipe: "Funcionários",
  loja: "Minha loja",
  financeiro: "Financeiro",
  impressao: "Impressoras",
  store: "Minha loja",
  order: "Pedidos",
  coupon: "Cupons",
  invoice: "Financeiro",
  fees: "Taxas",
  printer: "Impressoras",
  courier: "Entregadores",
};

export const ACTION_LABELS: Record<string, string> = {
  "auth.entrada": "Entrou no sistema",
  "auth.saida": "Saiu do sistema",
  "acesso.negado": "Tentou abrir área sem permissão",
  "pedidos.status": "Mudou a situação do pedido",
  "pedidos.status_forcado": "Forçou a situação do pedido",
  "produtos.criado": "Cadastrou produto",
  "produtos.editado": "Editou produto",
  "produtos.preco_alterado": "Alterou preço de produto",
  "menu.import_csv": "Importou planilha do cardápio",
  "menu.adjust_prices": "Reajustou preços",
  "equipe.convite_criado": "Convidou para a equipe",
  "equipe.convite_aceito": "Aceitou convite",
  "equipe.convite_cancelado": "Cancelou convite",
  "equipe.permissoes": "Mudou permissões",
  "equipe.nome": "Mudou nome de funcionário",
  "equipe.sessoes_encerradas": "Encerrou as sessões de um funcionário",
  "mesas.conta_aberta": "Abriu conta",
  "mesas.item_adicionado": "Lançou item na conta",
  "mesas.item_cancelado": "Cancelou item da conta",
  "mesas.pagamento": "Recebeu pagamento",
  "mesas.pagamento_cancelado": "Cancelou pagamento",
  "mesas.conta_fechada": "Fechou conta",
  "mesas.conta_cancelada": "Cancelou conta",
  "estoque.configuracao": "Mudou configuração do estoque",
  "estoque.ficha_tecnica": "Mudou ficha técnica",
  "estoque.alerta_conferido": "Conferiu alerta de estoque",
  "estoque.lista_criada": "Criou lista de compras",
  "estoque.lista_aprovada": "Aprovou lista de compras",
  "estoque.lista_cancelada": "Cancelou lista de compras",
  "store.update": "Editou dados da loja",
  "store.hours": "Mudou horários",
  "store.areas": "Mudou áreas de entrega",
  "store.payments": "Mudou formas de pagamento",
  "coupon.create": "Criou cupom",
  "coupon.toggle": "Ligou ou desligou cupom",
  "order.item_removed": "Removeu item do pedido",
  "order.assign_courier": "Escolheu entregador",
};

export const actionLabel = (action: string) => ACTION_LABELS[action] ?? action;
export const moduleLabel = (module: string | null) => (module ? AUDIT_MODULES[module] ?? module : "Outros");

export const AUDIT_RESULTS = { ok: "Concluída", negado: "Negada", erro: "Com erro" } as const;
export type AuditResult = keyof typeof AUDIT_RESULTS;

export type AuditFilters = {
  actorId?: string;
  module?: string;
  result?: AuditResult;
  /** Código do pedido, id do registro afetado ou parte do nome da ação. */
  search?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
};

export type AuditRow = {
  id: string; createdAt: Date; action: string; module: string | null; result: AuditResult;
  actorId: string | null; actorName: string | null; actorRole: string | null; process: string | null;
  entityType: string; entityId: string | null; reason: string | null; details: Record<string, unknown>;
};

// Nunca mostrados, mesmo que alguém grave por engano: senhas, códigos, tokens e hashes.
const SECRET_KEY = /senha|password|token|hash|secret|segredo|otp|pin/i;

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, SECRET_KEY.test(key) ? "••••" : redactSecrets(inner)]));
  }
  return value;
}

/**
 * Eventos da loja: tudo o que foi feito nela, mais as entradas e saídas do sistema de quem
 * é (ou foi) da equipe. A tabela só é lida pelo servidor, depois de conferida a permissão.
 */
export async function listStoreAudit(storeId: string, filters: AuditFilters): Promise<{ total: number; rows: AuditRow[] }> {
  const like = filters.search ? `%${filters.search.replace(/[\\%_]/g, "\\$&")}%` : null;
  const where = sql`
    (l.store_id = ${storeId}
      or (l.store_id is null and l.module = 'acesso' and l.actor_id in (select profile_id from store_members where store_id = ${storeId})))
    ${filters.actorId ? sql`and l.actor_id = ${filters.actorId}` : sql``}
    ${filters.module ? sql`and l.module = ${filters.module}` : sql``}
    ${filters.result ? sql`and l.result = ${filters.result}` : sql``}
    ${filters.from ? sql`and l.created_at >= ${filters.from}` : sql``}
    ${filters.to ? sql`and l.created_at < ${filters.to}` : sql``}
    ${like ? sql`and (l.entity_id::text ilike ${like} or l.action ilike ${like} or l.details->>'code' ilike ${like})` : sql``}`;

  const [[{ total }], rows] = await Promise.all([
    sql<{ total: number }[]>`select count(*)::int as total from audit_logs l where ${where}`,
    sql<{ id: string; created_at: Date; action: string; module: string | null; result: AuditResult; actor_id: string | null; actor_name: string | null; actor_role: string | null; process: string | null; entity_type: string; entity_id: string | null; reason: string | null; details: Record<string, unknown> }[]>`
      select l.id, l.created_at, l.action, l.module, l.result, l.actor_id, p.full_name as actor_name, l.actor_role, l.process,
             l.entity_type, l.entity_id::text, l.reason, l.details
      from audit_logs l left join profiles p on p.id = l.actor_id
      where ${where}
      order by l.created_at desc, l.id desc limit ${filters.limit} offset ${filters.offset}`,
  ]);
  return {
    total,
    rows: rows.map((row) => ({
      id: row.id, createdAt: row.created_at, action: row.action, module: row.module, result: row.result,
      actorId: row.actor_id, actorName: row.actor_name, actorRole: row.actor_role, process: row.process,
      entityType: row.entity_type, entityId: row.entity_id, reason: row.reason,
      details: redactSecrets(row.details ?? {}) as Record<string, unknown>,
    })),
  };
}

/** Os módulos que têm eventos nesta loja (para o filtro). */
export async function auditModules(storeId: string): Promise<string[]> {
  const rows = await sql<{ module: string }[]>`
    select distinct module from audit_logs where store_id = ${storeId} and module is not null
    union select 'acesso' order by 1`;
  return rows.map((row) => row.module);
}

/** Quem aparece no filtro "Quem fez": a equipe, inclusive quem já saiu. */
export async function auditActors(storeId: string) {
  return sql<{ id: string; name: string; active: boolean }[]>`
    select p.id, p.full_name as name, m.active from store_members m join profiles p on p.id = m.profile_id
    where m.store_id = ${storeId} order by m.active desc, p.full_name`;
}
