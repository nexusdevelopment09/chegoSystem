import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Button } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { sql } from "@/lib/db";
import { UNIT_LABELS, type StockUnit } from "@/lib/inventory/rules";
import { deleteRecipeLine, saveRecipeLine } from "./actions";
import { qty } from "./StockParts";

/**
 * Ficha técnica do produto: quanto de cada insumo vai em uma unidade dele, ou em uma opção
 * (o sabor da pizza naquele tamanho). É dela que sai o consumo estimado de insumos quando a
 * loja aceita um pedido, e as sugestões de reposição.
 */
export async function RecipeEditor({ storeId, productId }: { storeId: string; productId: string }) {
  const [lines, items, options] = await Promise.all([
    sql<{ id: string; item_name: string; unit: StockUnit; option_name: string | null; quantity: string }[]>`
      select r.id, i.name as item_name, i.unit, o.name as option_name, r.quantity::text
      from recipe_lines r join stock_items i on i.id = r.item_id left join options o on o.id = r.option_id
      where r.product_id = ${productId} and r.store_id = ${storeId} order by o.name nulls first, i.name`,
    sql<{ id: string; name: string; unit: StockUnit }[]>`select id, name, unit from stock_items where store_id = ${storeId} and status <> 'inativo' order by name`,
    sql<{ id: string; name: string; group_name: string }[]>`
      select o.id, o.name, g.name as group_name from product_option_groups pog
      join option_groups g on g.id = pog.group_id join options o on o.group_id = g.id
      where pog.product_id = ${productId} order by pog.sort_order, o.sort_order`,
  ]);

  return (
    <section className="flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach" data-testid="recipe">
      <h2 className="text-xl">Ficha técnica</h2>
      <p className="-mt-2 text-sm text-coffee-soft">
        Quanto de cada insumo do estoque vai em uma unidade deste produto. Quando a loja aceita um pedido, esses insumos saem do estoque
        (estimativa). Para pizza meio a meio, cadastre por sabor: cada metade conta pela fração.
      </p>
      {lines.length === 0 ? <p className="text-sm">Sem ficha técnica: o consumo de insumos deste produto não é estimado.</p> : (
        <ul className="divide-y divide-cream text-sm" data-testid="recipe-lines">
          {lines.map((line) => (
            <li key={line.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><strong>{qty(Number(line.quantity), line.unit)}</strong> de {line.item_name}{line.option_name ? ` · quando escolher “${line.option_name}”` : " · por unidade"}</span>
              <form action={deleteRecipeLine}><input type="hidden" name="id" value={line.id} /><Button type="submit" variant="secondary" className="min-h-11 px-3 text-xs">Tirar</Button></form>
            </li>
          ))}
        </ul>
      )}
      {items.length === 0 ? (
        <p className="text-sm">Cadastre os insumos em <Link href="/lojista/estoque" className="font-semibold text-brand-dark underline">Estoque</Link> para montar a ficha técnica.</p>
      ) : (
        <ActionForm action={saveRecipeLine} resetOnSuccess className="grid gap-2 sm:grid-cols-[2fr_1fr_2fr_auto] sm:items-end">
          <input type="hidden" name="productId" value={productId} />
          <label className="flex flex-col gap-1 text-xs font-semibold">Insumo
            <select name="itemId" required defaultValue="" className={inputClass}>
              <option value="" disabled>Escolha</option>
              {items.map((item) => <option key={item.id} value={item.id}>{item.name} ({UNIT_LABELS[item.unit].short})</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">Quantidade<input name="quantity" inputMode="decimal" required placeholder="0,150" className={inputClass} /></label>
          <label className="flex flex-col gap-1 text-xs font-semibold">Vale para
            <select name="optionId" defaultValue="" className={inputClass}>
              <option value="">Toda unidade do produto</option>
              {options.map((option) => <option key={option.id} value={option.id}>{option.group_name}: {option.name}</option>)}
            </select>
          </label>
          <SubmitButton variant="secondary" className="min-h-11 px-4 text-sm">Adicionar</SubmitButton>
        </ActionForm>
      )}
    </section>
  );
}
