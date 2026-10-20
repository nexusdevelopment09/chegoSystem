// Permissões da equipe de uma loja. Funções puras.
//
// O dono tem todas. Atendente e entregador começam com as do papel (DEFAULTS) e o dono pode
// trocar, uma a uma. Toda ação no servidor confere a permissão (requirePermission); esconder
// o botão é só conforto.

export const PERMISSIONS = {
  "dashboard.ver": { label: "Ver o resumo do dia", group: "Geral" },
  "pedidos.ver": { label: "Consultar pedidos", group: "Pedidos" },
  "pedidos.status": { label: "Aceitar e mudar a situação dos pedidos", group: "Pedidos" },
  "pedidos.cancelar": { label: "Recusar e cancelar pedidos", group: "Pedidos" },
  "clientes.ver": { label: "Ver nome, telefone e endereço do cliente do pedido", group: "Pedidos" },
  "produtos.ver": { label: "Consultar o cardápio", group: "Cardápio" },
  "produtos.editar": { label: "Criar e editar produtos", group: "Cardápio" },
  "produtos.precos": { label: "Alterar preços", group: "Cardápio" },
  "estoque.ver": { label: "Consultar estoque", group: "Estoque" },
  "estoque.movimentar": { label: "Registrar entradas e saídas", group: "Estoque" },
  "estoque.ajustar": { label: "Ajustar inventário e cadastrar itens", group: "Estoque" },
  "validade.ver": { label: "Consultar validade", group: "Estoque" },
  "estoque.perdas": { label: "Registrar perdas e descartes", group: "Estoque" },
  "reposicao.ver": { label: "Ver e montar listas de compras", group: "Estoque" },
  "mesas.gerenciar": { label: "Gerenciar mesas", group: "Atendimento" },
  "vendas.presenciais": { label: "Registrar vendas na mesa e no balcão", group: "Atendimento" },
  "vendas.descontos": { label: "Cancelar itens e pagamentos de uma conta", group: "Atendimento" },
  "relatorios.ver": { label: "Consultar relatórios", group: "Relatórios" },
  "relatorios.exportar": { label: "Exportar relatórios", group: "Relatórios" },
  "financeiro.ver": { label: "Ver valores financeiros e taxas do Chegô", group: "Relatórios" },
  "entregadores.ver": { label: "Consultar entregadores", group: "Equipe" },
  "entregadores.gerenciar": { label: "Gerenciar entregadores", group: "Equipe" },
  "equipe.gerenciar": { label: "Gerenciar funcionários", group: "Equipe" },
  "equipe.permissoes": { label: "Alterar permissões", group: "Equipe" },
  "auditoria.ver": { label: "Consultar a auditoria", group: "Equipe" },
  "loja.config": { label: "Configurações da loja", group: "Loja" },
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];
export type MemberRole = "owner" | "attendant" | "courier";

export const DEFAULTS: Record<MemberRole, Permission[]> = {
  owner: ALL_PERMISSIONS,
  attendant: [
    "dashboard.ver", "pedidos.ver", "pedidos.status", "pedidos.cancelar", "clientes.ver", "produtos.ver", "produtos.editar",
    "estoque.ver", "estoque.movimentar", "validade.ver", "mesas.gerenciar", "vendas.presenciais", "entregadores.ver",
  ],
  // O entregador da loja só vê as próprias entregas (a página Entregas), nada além.
  courier: [],
};

const isPermission = (value: string): value is Permission => value in PERMISSIONS;

/** As permissões de fato de um membro: o dono tem todas; os outros, as gravadas ou as do papel. */
export function effectivePermissions(role: MemberRole, stored: string[] | null): Permission[] {
  if (role === "owner") return ALL_PERMISSIONS;
  if (stored === null) return DEFAULTS[role];
  return stored.filter(isPermission);
}

export const can = (member: { role: MemberRole; permissions: Permission[] }, permission: Permission) =>
  member.role === "owner" || member.permissions.includes(permission);

/**
 * Pode `actor` dar a `target` estas permissões? Só quem tem "equipe.permissoes", nunca para si
 * mesmo, nunca mexendo no dono, e só permissões que o próprio actor tem (ninguém sobe acima de si).
 */
export function checkGrant(
  actor: { profileId: string; role: MemberRole; permissions: Permission[] },
  target: { profileId: string; role: MemberRole },
  wanted: string[],
): { ok: true; permissions: Permission[] } | { ok: false; error: string } {
  if (!can(actor, "equipe.permissoes")) return { ok: false, error: "Você não pode alterar permissões." };
  if (actor.profileId === target.profileId) return { ok: false, error: "Ninguém altera as próprias permissões." };
  if (target.role === "owner") return { ok: false, error: "As permissões do dono não mudam." };
  const unknown = wanted.filter((value) => !isPermission(value));
  if (unknown.length > 0) return { ok: false, error: "Permissão desconhecida." };
  const permissions = [...new Set(wanted as Permission[])];
  const above = permissions.filter((permission) => !can(actor, permission));
  if (above.length > 0) return { ok: false, error: `Você não pode dar uma permissão que não tem: ${PERMISSIONS[above[0]].label}.` };
  if (target.role === "courier" && permissions.some((permission) => !["entregadores.ver", "pedidos.ver"].includes(permission))) {
    return { ok: false, error: "Entregador só pode ter as permissões das entregas." };
  }
  return { ok: true, permissions };
}

/** As permissões agrupadas para as telas (Pedidos, Cardápio, Estoque...). */
export function permissionGroups(): { group: string; items: { key: Permission; label: string }[] }[] {
  const groups = new Map<string, { key: Permission; label: string }[]>();
  for (const key of ALL_PERMISSIONS) groups.set(PERMISSIONS[key].group, [...(groups.get(PERMISSIONS[key].group) ?? []), { key, label: PERMISSIONS[key].label }]);
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}
