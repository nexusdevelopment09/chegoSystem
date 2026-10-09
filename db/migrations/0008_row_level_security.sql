-- Row Level Security.
--
-- How it works here: the app connects as the database owner, and for every
-- query made on behalf of a user it opens a transaction, switches to the
-- restricted role `app_user` and stores the user's id in `app.user_id`
-- (see withUser in src/lib/db.ts). The policies below decide what that user
-- can see. No user id = anonymous visitor.
--
-- Anything that moves money or changes an order's status has no write policy:
-- it only happens in server code, as the owner, inside a transaction.

do $$
begin
  if not exists (select from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end $$;

-- ---------------------------------------------------------------- helpers

create function current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$;

-- The helpers below are "security definer" so they can look things up without
-- being blocked by (or recursing into) the policies that call them.

create function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from profiles
    where id = current_user_id()
      and role = 'admin'
      and blocked_at is null
      and deleted_at is null
  );
$$;

create function is_store_member(target_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from store_members
    where store_id = target_store and profile_id = current_user_id()
  );
$$;

-- Owner or attendant: runs the counter (orders and menu).
create function is_store_staff(target_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from store_members
    where store_id = target_store
      and profile_id = current_user_id()
      and role in ('owner', 'attendant')
  );
$$;

-- Owner only: money, team and store settings.
create function is_store_owner(target_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from store_members
    where store_id = target_store
      and profile_id = current_user_id()
      and role = 'owner'
  );
$$;

create function store_is_visible(target_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from stores
    where id = target_store
      and (status in ('active', 'paused') or is_store_member(id) or is_admin())
  );
$$;

create function store_of_product(target_product uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select store_id from products where id = target_product;
$$;

create function store_of_option_group(target_group uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select store_id from option_groups where id = target_group;
$$;

create function store_of_option(target_option uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select g.store_id
  from options o
  join option_groups g on g.id = o.group_id
  where o.id = target_option;
$$;

-- The store only sees an order after it was paid (the golden rule), and a
-- courier only sees the deliveries assigned to them.
create function can_view_order(target_order uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from orders o
    where o.id = target_order
      and (
        o.customer_id = current_user_id()
        or is_admin()
        or (o.paid_at is not null and is_store_staff(o.store_id))
        or (o.paid_at is not null and o.courier_id = current_user_id())
      )
  );
$$;

create function can_view_ticket(target_ticket uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from support_tickets t
    where t.id = target_ticket
      and (
        t.customer_id = current_user_id()
        or is_admin()
        or (t.store_involved and is_store_staff(t.store_id))
      )
  );
$$;

-- ------------------------------------------------------- enable and grant

do $$
declare
  table_name text;
begin
  for table_name in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', table_name);
  end loop;
end $$;

grant usage on schema public to app_user;
grant select on all tables in schema public to app_user;

-- Internal tables: not even readable.
revoke all on sessions, login_codes, rate_limits, schema_migrations, webhook_events from app_user;

-- Tables a user may write directly (always limited by the policies below).
grant insert, update, delete on
  addresses, carts, cart_items, favorites, push_subscriptions,
  product_sections, products, product_availability,
  option_groups, options, product_option_groups, product_option_prices
to app_user;

grant update (full_name, birth_date, city_id, promo_notifications) on profiles to app_user;
grant update (read_at) on notifications to app_user;

-- ------------------------------------------------------------ public data

create policy cities_read on cities for select to app_user using (true);
create policy neighborhoods_read on neighborhoods for select to app_user using (true);
create policy categories_read on categories for select to app_user using (true);
create policy subscription_plans_read on subscription_plans for select to app_user using (true);
create policy feature_flags_read on feature_flags for select to app_user using (true);

create policy banners_read on banners for select to app_user
  using ((active and starts_at <= now() and (ends_at is null or ends_at > now())) or is_admin());

create policy legal_documents_read on legal_documents for select to app_user
  using (published_at is not null or is_admin());

-- ----------------------------------------------------------------- people

create policy profiles_read on profiles for select to app_user
  using (id = current_user_id() or is_admin());

create policy profiles_update_own on profiles for update to app_user
  using (id = current_user_id())
  with check (id = current_user_id());

create policy addresses_own on addresses for all to app_user
  using (profile_id = current_user_id())
  with check (profile_id = current_user_id());

create policy addresses_admin_read on addresses for select to app_user
  using (is_admin());

create policy favorites_own on favorites for all to app_user
  using (profile_id = current_user_id())
  with check (profile_id = current_user_id());

create policy push_subscriptions_own on push_subscriptions for all to app_user
  using (profile_id = current_user_id())
  with check (profile_id = current_user_id());

create policy notifications_read_own on notifications for select to app_user
  using (profile_id = current_user_id());

create policy notifications_mark_read on notifications for update to app_user
  using (profile_id = current_user_id())
  with check (profile_id = current_user_id());

create policy legal_acceptances_read on legal_acceptances for select to app_user
  using (profile_id = current_user_id() or is_admin());

create policy referrals_read on referrals for select to app_user
  using (referrer_id = current_user_id() or referred_id = current_user_id() or is_admin());

-- ----------------------------------------------------------------- stores

-- Pending and suspended stores are invisible to customers and other stores.
create policy stores_read on stores for select to app_user
  using (status in ('active', 'paused') or is_store_member(id) or is_admin());

create policy store_private_read on store_private for select to app_user
  using (is_store_owner(store_id) or is_admin());

-- A courier sees only their own membership; owner and attendant see the team.
create policy store_members_read on store_members for select to app_user
  using (profile_id = current_user_id() or is_store_staff(store_id) or is_admin());

create policy store_hours_read on store_hours for select to app_user
  using (store_is_visible(store_id));

create policy store_closures_read on store_closures for select to app_user
  using (store_is_visible(store_id));

create policy store_delivery_areas_read on store_delivery_areas for select to app_user
  using (store_is_visible(store_id));

create policy store_subscriptions_read on store_subscriptions for select to app_user
  using (is_store_owner(store_id) or is_admin());

create policy invoices_read on invoices for select to app_user
  using (is_store_owner(store_id) or is_admin());

-- ---------------------------------------------------------------- catalog

create policy product_sections_read on product_sections for select to app_user
  using (store_is_visible(store_id));

create policy product_sections_write on product_sections for all to app_user
  using (is_store_staff(store_id))
  with check (is_store_staff(store_id));

create policy products_read on products for select to app_user
  using ((deleted_at is null and store_is_visible(store_id)) or is_store_staff(store_id) or is_admin());

create policy products_write on products for all to app_user
  using (is_store_staff(store_id))
  with check (is_store_staff(store_id));

create policy product_availability_read on product_availability for select to app_user
  using (store_is_visible(store_of_product(product_id)));

create policy product_availability_write on product_availability for all to app_user
  using (is_store_staff(store_of_product(product_id)))
  with check (is_store_staff(store_of_product(product_id)));

create policy option_groups_read on option_groups for select to app_user
  using (store_is_visible(store_id));

create policy option_groups_write on option_groups for all to app_user
  using (is_store_staff(store_id))
  with check (is_store_staff(store_id));

create policy options_read on options for select to app_user
  using (store_is_visible(store_of_option_group(group_id)));

create policy options_write on options for all to app_user
  using (is_store_staff(store_of_option_group(group_id)))
  with check (is_store_staff(store_of_option_group(group_id)));

create policy product_option_groups_read on product_option_groups for select to app_user
  using (store_is_visible(store_of_product(product_id)));

-- Both ends must belong to the same store the user works for.
create policy product_option_groups_write on product_option_groups for all to app_user
  using (is_store_staff(store_of_product(product_id)))
  with check (
    is_store_staff(store_of_product(product_id))
    and store_of_option_group(group_id) = store_of_product(product_id)
  );

create policy product_option_prices_read on product_option_prices for select to app_user
  using (store_is_visible(store_of_product(product_id)));

create policy product_option_prices_write on product_option_prices for all to app_user
  using (is_store_staff(store_of_product(product_id)))
  with check (
    is_store_staff(store_of_product(product_id))
    and store_of_option(option_id) = store_of_product(product_id)
  );

-- ------------------------------------------------------- carts and orders

create policy carts_own on carts for all to app_user
  using (profile_id = current_user_id())
  with check (profile_id = current_user_id());

create policy cart_items_own on cart_items for all to app_user
  using (exists (select 1 from carts c where c.id = cart_id and c.profile_id = current_user_id()))
  with check (exists (select 1 from carts c where c.id = cart_id and c.profile_id = current_user_id()));

create policy orders_read on orders for select to app_user
  using (
    customer_id = current_user_id()
    or is_admin()
    or (paid_at is not null and is_store_staff(store_id))
    or (paid_at is not null and courier_id = current_user_id())
  );

create policy order_items_read on order_items for select to app_user
  using (can_view_order(order_id));

create policy order_item_options_read on order_item_options for select to app_user
  using (exists (select 1 from order_items i where i.id = order_item_id and can_view_order(i.order_id)));

create policy order_status_history_read on order_status_history for select to app_user
  using (can_view_order(order_id));

-- Couriers deliver; they do not read the chat between customer and store.
create policy order_messages_read on order_messages for select to app_user
  using (exists (
    select 1 from orders o
    where o.id = order_id
      and (
        o.customer_id = current_user_id()
        or is_admin()
        or (o.paid_at is not null and is_store_staff(o.store_id))
      )
  ));

create policy blocked_message_attempts_read on blocked_message_attempts for select to app_user
  using (is_admin());

-- Generic coupon codes are never listed: they are checked on the server.
create policy coupons_read on coupons for select to app_user
  using (
    is_admin()
    or owner_profile_id = current_user_id()
    or (created_by_store_id is not null and is_store_staff(created_by_store_id))
  );

create policy coupon_redemptions_read on coupon_redemptions for select to app_user
  using (customer_id = current_user_id() or is_admin());

create policy reviews_read on reviews for select to app_user
  using (
    hidden_at is null
    or customer_id = current_user_id()
    or is_store_staff(store_id)
    or is_admin()
  );

-- ------------------------------------------------------------------ money

create policy payments_read on payments for select to app_user
  using (
    is_admin()
    or (order_id is not null and exists (
      select 1 from orders o where o.id = order_id and o.customer_id = current_user_id()
    ))
    or (invoice_id is not null and exists (
      select 1 from invoices i where i.id = invoice_id and is_store_owner(i.store_id)
    ))
  );

create policy refunds_read on refunds for select to app_user
  using (
    is_admin()
    or exists (
      select 1 from orders o
      where o.id = order_id
        and (o.customer_id = current_user_id() or is_store_owner(o.store_id))
    )
  );

-- The statement is for the owner only: attendants and couriers see no money.
create policy ledger_entries_read on ledger_entries for select to app_user
  using (is_admin() or (account = 'store' and is_store_owner(store_id)));

-- ---------------------------------------------------- support and platform

create policy support_tickets_read on support_tickets for select to app_user
  using (
    customer_id = current_user_id()
    or is_admin()
    or (store_involved and is_store_staff(store_id))
  );

create policy ticket_messages_read on ticket_messages for select to app_user
  using (can_view_ticket(ticket_id));

create policy outbound_messages_read on outbound_messages for select to app_user
  using (is_admin());

create policy platform_settings_read on platform_settings for select to app_user
  using (is_admin());

create policy audit_logs_read on audit_logs for select to app_user
  using (is_admin());
