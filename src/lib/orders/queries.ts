import "server-only";
import { describeOptions, type SnapshotOption } from "@/lib/catalog/selection";
import { withUser } from "@/lib/db";
import type { Totals } from "./totals";
import type { Fulfillment, OrderStatus } from "./status";

export type OrderItemView = {
  id: string;
  productId: string | null;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  notes: string | null;
  lines: string[];
  removed: boolean;
  removedReason: string | null;
};

export type OrderView = {
  id: string;
  code: string;
  status: OrderStatus;
  fulfillment: Fulfillment;
  storeId: string;
  storeName: string;
  storeSlug: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  address: { street: string; number: string; neighborhood: string; reference: string | null; complement: string | null; city: string } | null;
  scheduledFor: Date | null;
  estimatedAt: Date | null;
  totals: Totals;
  refundedCents: number;
  paymentMethod: "pix" | "card" | "cash";
  requiresAgeCheck: boolean;
  missingItemPolicy: "call" | "substitute" | "remove" | null;
  notes: string | null;
  deliveryCode: string | null;
  courierId: string | null;
  /** Primeiro nome de quem está entregando, quando já há um entregador. */
  courierName: string | null;
  /** "platform" = a entrega é da rede do Chegô; "store" = a própria loja entrega. */
  deliveryProvider: "store" | "platform";
  paymentExpiresAt: Date | null;
  paidAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  items: OrderItemView[];
  history: { status: OrderStatus; reason: string | null; at: Date }[];
};

type OrderRow = {
  id: string; code: string; status: OrderStatus; fulfillment: Fulfillment; store_id: string; store_name: string;
  store_slug: string; customer_id: string; customer_name: string; customer_phone: string | null;
  address_snapshot: OrderView["address"]; scheduled_for: Date | null; estimated_at: Date | null;
  subtotal_cents: number; discount_cents: number; delivery_fee_cents: number; service_fee_cents: number;
  commission_cents: number; store_amount_cents: number; platform_amount_cents: number; total_cents: number;
  refunded_cents: number; payment_method: OrderView["paymentMethod"]; requires_age_check: boolean;
  missing_item_policy: OrderView["missingItemPolicy"]; notes: string | null; delivery_code: string | null;
  courier_id: string | null; courier_name: string | null; delivery_provider: "store" | "platform";
  payment_expires_at: Date | null; paid_at: Date | null;
  completed_at: Date | null; created_at: Date;
};

/**
 * Pedidos que o usuário pode ver, carregados como esse usuário: as regras de acesso
 * por linha (RLS) decidem (cliente: os próprios pedidos; equipe da loja: pedidos pagos
 * da loja; entregador: as próprias entregas; admin: tudo).
 */
export async function loadOrders(
  viewerId: string,
  filter: { id?: string; customerId?: string; storeId?: string; statuses?: OrderStatus[]; courierId?: string; since?: Date; limit?: number },
): Promise<OrderView[]> {
  return withUser(viewerId, async (tx) => {
    const orders = await tx<OrderRow[]>`
      select o.id, o.code, o.status, o.fulfillment, o.store_id, s.name as store_name, s.slug as store_slug,
             o.customer_id, o.customer_name, o.customer_phone, o.address_snapshot, o.scheduled_for, o.estimated_at,
             o.subtotal_cents, o.discount_cents, o.delivery_fee_cents, o.service_fee_cents, o.commission_cents,
             o.store_amount_cents, o.platform_amount_cents, o.total_cents, o.refunded_cents, o.payment_method,
             o.requires_age_check, o.missing_item_policy, o.notes, o.delivery_code, o.courier_id,
             courier_first_name(o.courier_id) as courier_name, o.delivery_provider,
             o.payment_expires_at, o.paid_at, o.completed_at, o.created_at
      from orders o
      join stores s on s.id = o.store_id
      where true
        ${filter.id ? tx`and o.id = ${filter.id}` : tx``}
        ${filter.customerId ? tx`and o.customer_id = ${filter.customerId}` : tx``}
        ${filter.storeId ? tx`and o.store_id = ${filter.storeId}` : tx``}
        ${filter.courierId ? tx`and o.courier_id = ${filter.courierId}` : tx``}
        ${filter.statuses ? tx`and o.status::text = any(${filter.statuses})` : tx``}
        ${filter.since ? tx`and o.created_at >= ${filter.since}` : tx``}
      order by o.created_at desc
      limit ${filter.limit ?? 100}`;
    if (orders.length === 0) return [];

    const ids = orders.map((order) => order.id);
    const items = await tx<{
      id: string; order_id: string; product_id: string | null; name: string; quantity: number; unit_price_cents: number;
      line_total_cents: number; notes: string | null; removed_at: Date | null; removed_reason: string | null;
    }[]>`
      select id, order_id, product_id, name, quantity, unit_price_cents, line_total_cents, notes, removed_at, removed_reason
      from order_items where order_id = any(${ids}::uuid[]) order by id`;
    const options = await tx<(SnapshotOption & { order_item_id: string })[]>`
      select order_item_id, group_name as "groupName", option_name as "optionName", price_mode as mode, quantity
      from order_item_options
      where order_item_id = any(${items.map((item) => item.id)}::uuid[])
      order by sort_order`;
    const history = await tx<{ order_id: string; status: OrderStatus; reason: string | null; created_at: Date }[]>`
      select order_id, status, reason, created_at
      from order_status_history where order_id = any(${ids}::uuid[]) order by created_at`;
    return orders.map((order): OrderView => ({
      id: order.id, code: order.code, status: order.status, fulfillment: order.fulfillment,
      storeId: order.store_id, storeName: order.store_name, storeSlug: order.store_slug,
      customerId: order.customer_id, customerName: order.customer_name, customerPhone: order.customer_phone,
      address: order.address_snapshot, scheduledFor: order.scheduled_for, estimatedAt: order.estimated_at,
      totals: {
        subtotalCents: order.subtotal_cents, discountCents: order.discount_cents, deliveryFeeCents: order.delivery_fee_cents,
        serviceFeeCents: order.service_fee_cents, commissionCents: order.commission_cents,
        storeAmountCents: order.store_amount_cents, platformAmountCents: order.platform_amount_cents, totalCents: order.total_cents,
      },
      refundedCents: order.refunded_cents, paymentMethod: order.payment_method, requiresAgeCheck: order.requires_age_check,
      missingItemPolicy: order.missing_item_policy, notes: order.notes, deliveryCode: order.delivery_code,
      courierId: order.courier_id, courierName: order.courier_name, deliveryProvider: order.delivery_provider,
      paymentExpiresAt: order.payment_expires_at, paidAt: order.paid_at, completedAt: order.completed_at, createdAt: order.created_at,
      items: items.filter((item) => item.order_id === order.id).map((item) => ({
        id: item.id, productId: item.product_id, name: item.name, quantity: item.quantity,
        unitPriceCents: item.unit_price_cents, lineTotalCents: item.line_total_cents, notes: item.notes,
        lines: describeOptions(options.filter((option) => option.order_item_id === item.id)),
        removed: item.removed_at !== null, removedReason: item.removed_reason,
      })),
      history: history.filter((entry) => entry.order_id === order.id).map((entry) => ({ status: entry.status, reason: entry.reason, at: entry.created_at })),
    }));
  }) as Promise<OrderView[]>;
}

export async function loadOrder(viewerId: string, orderId: string): Promise<OrderView | null> {
  return (await loadOrders(viewerId, { id: orderId, limit: 1 }))[0] ?? null;
}
