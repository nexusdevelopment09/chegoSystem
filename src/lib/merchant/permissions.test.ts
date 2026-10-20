import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, can, checkGrant, DEFAULTS, effectivePermissions } from "./permissions";

const owner = { profileId: "dono", role: "owner" as const, permissions: ALL_PERMISSIONS };
const manager = { profileId: "gerente", role: "attendant" as const, permissions: [...DEFAULTS.attendant, "equipe.permissoes" as const] };

describe("permissões da equipe", () => {
  it("dono tem todas; atendente começa com as do papel; entregador com nenhuma", () => {
    expect(effectivePermissions("owner", [])).toEqual(ALL_PERMISSIONS);
    expect(effectivePermissions("attendant", null)).toEqual(DEFAULTS.attendant);
    expect(effectivePermissions("courier", null)).toEqual([]);
    // Valores gravados que não existem mais são ignorados.
    expect(effectivePermissions("attendant", ["pedidos.ver", "coisa.antiga"])).toEqual(["pedidos.ver"]);
    expect(can({ role: "attendant", permissions: DEFAULTS.attendant }, "financeiro.ver")).toBe(false);
    expect(can({ role: "owner", permissions: [] }, "financeiro.ver")).toBe(true);
  });

  it("ninguém dá permissão que não tem, nem para si mesmo, nem mexe no dono", () => {
    const attendant = { profileId: "ana", role: "attendant" as const };
    expect(checkGrant(owner, attendant, ["financeiro.ver"])).toEqual({ ok: true, permissions: ["financeiro.ver"] });
    expect(checkGrant(manager, attendant, ["financeiro.ver"])).toMatchObject({ ok: false, error: expect.stringContaining("não tem") });
    expect(checkGrant(manager, { profileId: "gerente", role: "attendant" }, ["pedidos.ver"])).toMatchObject({ ok: false, error: "Ninguém altera as próprias permissões." });
    expect(checkGrant(manager, { profileId: "dono", role: "owner" }, [])).toMatchObject({ ok: false });
    expect(checkGrant({ ...manager, permissions: DEFAULTS.attendant }, attendant, ["pedidos.ver"])).toMatchObject({ ok: false, error: "Você não pode alterar permissões." });
    expect(checkGrant(owner, attendant, ["inventada"])).toMatchObject({ ok: false, error: "Permissão desconhecida." });
  });

  it("entregador só recebe as permissões das entregas; repetições somem", () => {
    const courier = { profileId: "wes", role: "courier" as const };
    expect(checkGrant(owner, courier, ["pedidos.ver", "pedidos.ver"])).toEqual({ ok: true, permissions: ["pedidos.ver"] });
    expect(checkGrant(owner, courier, ["financeiro.ver"])).toMatchObject({ ok: false });
  });
});
