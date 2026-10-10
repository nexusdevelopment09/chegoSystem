import { getCurrentProfile } from "@/lib/auth/session";
import { sql } from "@/lib/db";

// "Baixar meus dados" (LGPD): tudo o que o app guarda sobre a pessoa que entrou, em JSON.
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return new Response("Unauthorized", { status: 401 });
  const id = profile.id;

  const [[account], addresses, orders, reviews, favorites, tickets, messages, acceptances, coupons] = await Promise.all([
    sql`select full_name, phone, email, birth_date::text, role, referral_code, promo_notifications, accepted_terms_at, created_at from profiles where id = ${id}`,
    sql`select a.label, a.street, a.number, n.name as neighborhood, a.reference, a.complement, a.is_default, a.created_at
        from addresses a join neighborhoods n on n.id = a.neighborhood_id where a.profile_id = ${id} and a.deleted_at is null`,
    sql`select o.code, s.name as store, o.status, o.fulfillment, o.address_snapshot, o.scheduled_for, o.subtotal_cents, o.discount_cents,
               o.delivery_fee_cents, o.service_fee_cents, o.total_cents, o.refunded_cents, o.payment_method, o.notes, o.created_at,
               (select json_agg(json_build_object('name', i.name, 'quantity', i.quantity, 'unit_price_cents', i.unit_price_cents, 'notes', i.notes))
                from order_items i where i.order_id = o.id) as items
        from orders o join stores s on s.id = o.store_id where o.customer_id = ${id} order by o.created_at`,
    sql`select o.code as "order", r.rating, r.comment, r.created_at from reviews r join orders o on o.id = r.order_id where r.customer_id = ${id}`,
    sql`select s.name as store, f.created_at from favorites f join stores s on s.id = f.store_id where f.profile_id = ${id}`,
    sql`select o.code as "order", t.reason, t.status, t.created_at from support_tickets t join orders o on o.id = t.order_id where t.customer_id = ${id}`,
    sql`select o.code as "order", m.body, m.created_at from order_messages m join orders o on o.id = m.order_id where m.sender_id = ${id}`,
    sql`select d.type, d.version, a.accepted_at from legal_acceptances a join legal_documents d on d.id = a.document_id where a.profile_id = ${id}`,
    sql`select code, description, expires_at from coupons where owner_profile_id = ${id}`,
  ]);

  const data = { exported_at: new Date().toISOString(), account, addresses, orders, reviews, favorites, support_tickets: tickets, order_messages: messages, accepted_terms: acceptances, personal_coupons: coupons };
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="meus-dados-chego.json"',
      "Cache-Control": "no-store",
    },
  });
}
