// GENERATED FILE. Do not edit: run `npm run db:types` after changing migrations.

export type AdPlacement = "inicio" | "topo" | "categoria" | "promocional";
export type AdStatus = "ativa" | "pausada" | "encerrada";
export type BillStatus = "aberta" | "fechada" | "cancelada";
export type ClosingStatus = "awaiting_payment" | "paid" | "overdue" | "in_review";
export type CouponType = "fixed" | "percent" | "free_delivery";
export type CourierEarningStatus = "pending" | "paid_by_store" | "confirmed" | "disputed";
export type CourierKind = "platform" | "partner";
export type CourierPayer = "platform" | "store";
export type CourierStatus = "pending" | "active" | "blocked";
export type DeliveryProvider = "store" | "platform";
export type DiscountPayer = "platform" | "store";
export type FeeChargeStatus = "pending" | "paid" | "expired" | "cancelled" | "in_review";
export type FeeEntryKind = "order_fee" | "order_fee_reversal" | "coupon_credit" | "coupon_credit_reversal" | "adjustment" | "carryover";
export type FulfillmentType = "delivery" | "pickup";
export type InvoiceStatus = "open" | "paid" | "overdue" | "cancelled";
export type LedgerAccount = "store" | "platform" | "courier";
export type LedgerDirection = "credit" | "debit";
export type LegalDocumentType = "terms" | "merchant_terms" | "privacy";
export type MessageChannel = "sms" | "whatsapp" | "email" | "push";
export type MessageSide = "customer" | "store" | "admin";
export type MissingItemPolicy = "call" | "substitute" | "remove";
export type OptionPriceMode = "sum" | "highest" | "average" | "free_up_to";
export type OrderStatus = "awaiting_payment" | "paid" | "accepted" | "preparing" | "ready" | "out_for_delivery" | "delivered" | "picked_up" | "expired" | "rejected" | "cancelled" | "refunded" | "partially_refunded";
export type PaymentCollection = "app" | "store";
export type PaymentMethod = "pix" | "card" | "cash";
export type PaymentStatus = "pending" | "approved" | "declined" | "expired" | "refunded" | "partially_refunded";
export type PizzaPricingRule = "highest" | "average";
export type PrintJobStatus = "pending" | "sending" | "sent" | "failed" | "unknown";
export type PrintKind = "completo" | "cozinha" | "comprovante" | "teste";
export type PrinterSector = "caixa" | "cozinha" | "expedicao" | "geral";
export type ProductType = "standard" | "variant" | "service";
export type PurchaseListStatus = "rascunho" | "aprovada" | "recebida" | "cancelada";
export type SaleChannel = "app" | "mesa" | "balcao";
export type StockAlertKind = "baixo" | "vencendo" | "vencido" | "conferir";
export type StockItemStatus = "ativo" | "inativo" | "indisponivel";
export type StockMovementKind = "compra" | "venda" | "producao" | "perda" | "vencido" | "ajuste" | "devolucao" | "transferencia";
export type StockUnit = "un" | "kg" | "g" | "l" | "ml" | "pacote" | "caixa";
export type StoreManualState = "auto" | "open" | "closed";
export type StoreMemberRole = "owner" | "attendant" | "courier";
export type StoreStatus = "pending" | "active" | "paused" | "suspended";
export type TicketReason = "delay" | "missing_item" | "wrong_item" | "damaged_item" | "billing" | "other";
export type TicketStatus = "open" | "in_progress" | "waiting_customer" | "resolved";
export type UserRole = "customer" | "merchant" | "admin" | "courier";

export interface AdCampaignsRow {
  id: string;
  store_id: string;
  title: string;
  placement: AdPlacement;
  category_id: string | null;
  priority: number;
  starts_at: Date;
  ends_at: Date;
  status: AdStatus;
  price_cents: number;
  notes: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  ended_at: Date | null;
}

export interface AdDailyStatsRow {
  campaign_id: string;
  day: Date;
  impressions: number;
  clicks: number;
}

export interface AddressesRow {
  id: string;
  profile_id: string;
  label: string | null;
  street: string;
  number: string;
  neighborhood_id: string;
  reference: string | null;
  complement: string | null;
  lat: string | null;
  lng: string | null;
  is_default: boolean;
  deleted_at: Date | null;
  created_at: Date;
}

export interface AuditLogsRow {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  store_id: string | null;
  details: unknown;
  created_at: Date;
  actor_role: string | null;
  module: string | null;
  result: string;
  reason: string | null;
  process: string | null;
  request_id: string | null;
}

export interface BannersRow {
  id: string;
  city_id: string | null;
  title: string;
  image_url: string;
  link_url: string | null;
  starts_at: Date;
  ends_at: Date | null;
  sort_order: number;
  active: boolean;
}

export interface BlockedMessageAttemptsRow {
  id: string;
  order_id: string;
  sender_id: string;
  body: string;
  matched_rule: string;
  created_at: Date;
}

export interface CartItemsRow {
  id: string;
  cart_id: string;
  product_id: string;
  quantity: number;
  notes: string | null;
  selections: unknown;
  created_at: Date;
}

export interface CartsRow {
  id: string;
  profile_id: string;
  store_id: string;
  notes: string | null;
  updated_at: Date;
}

export interface CategoriesRow {
  id: string;
  name: string;
  slug: string;
  icon: string;
  color: string;
  sort_order: number;
  active: boolean;
}

export interface CitiesRow {
  id: string;
  name: string;
  state: string;
  slug: string;
  order_code_prefix: string;
  next_order_number: number;
  active: boolean;
  maintenance_mode: boolean;
  created_at: Date;
}

export interface CouponRedemptionsRow {
  id: string;
  coupon_id: string;
  order_id: string;
  customer_id: string | null;
  discount_cents: number;
  created_at: Date;
  customer_phone: string | null;
}

export interface CouponsRow {
  id: string;
  code: string;
  description: string;
  type: CouponType;
  value_cents: number | null;
  percent: string | null;
  max_discount_cents: number | null;
  paid_by: DiscountPayer;
  created_by_store_id: string | null;
  owner_profile_id: string | null;
  starts_at: Date | null;
  expires_at: Date | null;
  max_uses: number | null;
  uses_count: number;
  max_uses_per_customer: number;
  min_order_cents: number;
  first_order_only: boolean;
  store_ids: string[];
  category_ids: string[];
  city_ids: string[];
  active: boolean;
  created_at: Date;
}

export interface CourierEarningsRow {
  id: string;
  order_id: string;
  courier_id: string;
  amount_cents: number;
  paid_at: Date | null;
  paid_by: string | null;
  created_at: Date;
  payer: CourierPayer;
  store_id: string | null;
  status: CourierEarningStatus;
  store_marked_paid_at: Date | null;
  confirmed_at: Date | null;
  dispute_reason: string | null;
}

export interface CouriersRow {
  profile_id: string;
  kind: CourierKind;
  status: CourierStatus;
  city_id: string;
  document_type: string;
  document_number: string;
  vehicle: string;
  plate: string | null;
  available: boolean;
  approved_at: Date | null;
  blocked_reason: string | null;
  created_at: Date;
  updated_at: Date;
  last_seen_at: Date | null;
}

export interface FavoritesRow {
  profile_id: string;
  store_id: string;
  created_at: Date;
}

export interface FeatureFlagsRow {
  key: string;
  enabled: boolean;
  description: string;
  updated_at: Date;
}

export interface FeeChargesRow {
  id: string;
  closing_id: string;
  store_id: string;
  provider: string;
  provider_charge_id: string;
  amount_cents: number;
  status: FeeChargeStatus;
  pix_copy_paste: string | null;
  expires_at: Date;
  created_at: Date;
  paid_at: Date | null;
}

export interface FeeEntriesRow {
  id: string;
  store_id: string;
  order_id: string | null;
  kind: FeeEntryKind;
  amount_cents: number;
  business_date: Date;
  closing_id: string | null;
  reverses_id: string | null;
  carried_from_closing_id: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: Date;
}

export interface FeePaymentsRow {
  id: string;
  charge_id: string;
  provider: string;
  provider_transaction_id: string;
  amount_cents: number;
  applied: boolean;
  received_at: Date;
  raw_payload: unknown | null;
}

export interface InvoicesRow {
  id: string;
  store_id: string;
  subscription_id: string;
  period_start: Date;
  period_end: Date;
  amount_cents: number;
  status: InvoiceStatus;
  due_date: Date;
  paid_at: Date | null;
  created_at: Date;
}

export interface LedgerEntriesRow {
  id: string;
  account: LedgerAccount;
  store_id: string | null;
  direction: LedgerDirection;
  amount_cents: number;
  reason: string;
  order_id: string | null;
  refund_id: string | null;
  invoice_id: string | null;
  created_at: Date;
  courier_id: string | null;
}

export interface LegalAcceptancesRow {
  id: string;
  profile_id: string;
  document_id: string;
  accepted_at: Date;
}

export interface LegalDocumentsRow {
  id: string;
  type: LegalDocumentType;
  version: number;
  title: string;
  content: string;
  published_at: Date | null;
  created_at: Date;
}

export interface LoginCodesRow {
  id: string;
  phone: string;
  code_hash: string;
  attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

export interface NeighborhoodsRow {
  id: string;
  city_id: string;
  name: string;
  is_rural: boolean;
  active: boolean;
}

export interface NotificationsRow {
  id: string;
  profile_id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  order_id: string | null;
  promotional: boolean;
  read_at: Date | null;
  created_at: Date;
}

export interface OptionGroupsRow {
  id: string;
  store_id: string;
  name: string;
  created_at: Date;
}

export interface OptionsRow {
  id: string;
  group_id: string;
  name: string;
  description: string;
  category_label: string | null;
  default_price_cents: number;
  available: boolean;
  sort_order: number;
}

export interface OrderItemOptionsRow {
  id: string;
  order_item_id: string;
  option_id: string | null;
  group_name: string;
  option_name: string;
  price_mode: OptionPriceMode;
  quantity: number;
  price_cents: number;
  sort_order: number;
}

export interface OrderItemsRow {
  id: string;
  order_id: string;
  product_id: string | null;
  name: string;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
  notes: string | null;
  requires_age_check: boolean;
  removed_at: Date | null;
  removed_reason: string | null;
  weight_step_grams: number | null;
}

export interface OrderMessagesRow {
  id: string;
  order_id: string;
  sender_id: string;
  sender_side: MessageSide;
  body: string;
  read_at: Date | null;
  created_at: Date;
}

export interface OrderStatusHistoryRow {
  id: string;
  order_id: string;
  status: OrderStatus;
  changed_by: string | null;
  reason: string | null;
  created_at: Date;
}

export interface OrdersRow {
  id: string;
  code: string;
  city_id: string;
  customer_id: string | null;
  store_id: string;
  status: OrderStatus;
  fulfillment: FulfillmentType;
  customer_name: string;
  customer_phone: string | null;
  address_snapshot: unknown | null;
  neighborhood_id: string | null;
  scheduled_for: Date | null;
  estimated_at: Date | null;
  subtotal_cents: number;
  discount_cents: number;
  discount_paid_by: DiscountPayer | null;
  coupon_id: string | null;
  delivery_fee_cents: number;
  service_fee_cents: number;
  commission_rate: string;
  commission_cents: number;
  store_amount_cents: number;
  platform_amount_cents: number;
  total_cents: number;
  refunded_cents: number;
  payment_method: PaymentMethod;
  age_confirmed: boolean;
  requires_age_check: boolean;
  missing_item_policy: MissingItemPolicy | null;
  notes: string | null;
  delivery_code: string | null;
  courier_id: string | null;
  payment_expires_at: Date | null;
  paid_at: Date | null;
  accepted_at: Date | null;
  ready_at: Date | null;
  dispatched_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  delivery_provider: DeliveryProvider;
  courier_fee_cents: number;
  courier_assigned_at: Date | null;
  payment_collection: PaymentCollection;
  cash_change_for_cents: number | null;
  guest_token_hash: string | null;
  channel: SaleChannel;
  ad_campaign_id: string | null;
}

export interface OutboundMessagesRow {
  id: string;
  channel: MessageChannel;
  recipient: string;
  profile_id: string | null;
  subject: string | null;
  body: string;
  created_at: Date;
}

export interface PaymentsRow {
  id: string;
  order_id: string | null;
  invoice_id: string | null;
  provider: string;
  provider_payment_id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount_cents: number;
  pix_copy_paste: string | null;
  expires_at: Date | null;
  raw_payload: unknown | null;
  created_at: Date;
  updated_at: Date;
}

export interface PlatformSettingsRow {
  key: string;
  value: unknown;
  description: string;
  updated_at: Date;
  updated_by: string | null;
}

export interface PrintJobsRow {
  id: string;
  store_id: string;
  printer_id: string | null;
  order_id: string | null;
  kind: PrintKind;
  reprint: boolean;
  status: PrintJobStatus;
  attempts: number;
  error: string | null;
  device_id: string | null;
  requested_by: string | null;
  created_at: Date;
  claimed_at: Date | null;
  finished_at: Date | null;
}

export interface ProductAvailabilityRow {
  id: string;
  product_id: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
}

export interface ProductOptionGroupsRow {
  id: string;
  product_id: string;
  group_id: string;
  required: boolean;
  min_choices: number;
  max_choices: number;
  allow_repeat: boolean;
  price_mode: OptionPriceMode;
  free_quantity: number;
  sort_order: number;
}

export interface ProductOptionPricesRow {
  product_id: string;
  option_id: string;
  price_cents: number;
}

export interface ProductSectionsRow {
  id: string;
  store_id: string;
  name: string;
  sort_order: number;
}

export interface ProductsRow {
  id: string;
  store_id: string;
  section_id: string | null;
  name: string;
  description: string;
  price_cents: number;
  image_url: string | null;
  available: boolean;
  featured: boolean;
  sort_order: number;
  min_lead_minutes: number;
  max_per_order: number | null;
  track_stock: boolean;
  stock_qty: number | null;
  requires_age_check: boolean;
  product_type: ProductType;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  weight_step_grams: number | null;
  price_per_kg_cents: number | null;
  weight_min_grams: number | null;
  subcategory_id: string | null;
  compare_at_price_cents: number | null;
}

export interface ProfilesRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  password_hash: string | null;
  role: UserRole;
  accepted_terms_at: Date | null;
  cash_enabled: boolean;
  blocked_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  birth_date: Date | null;
  referral_code: string | null;
  blocked_reason: string | null;
  city_id: string | null;
  promo_notifications: boolean;
  is_super_admin: boolean;
}

export interface PurchaseListItemsRow {
  id: string;
  list_id: string;
  item_id: string;
  suggested_quantity: string;
  quantity: string;
  unit_cost_cents: number | null;
  reason: string | null;
}

export interface PurchaseListsRow {
  id: string;
  store_id: string;
  status: PurchaseListStatus;
  created_by: string;
  approved_by: string | null;
  approved_at: Date | null;
  received_at: Date | null;
  created_at: Date;
}

export interface PushSubscriptionsRow {
  id: string;
  profile_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: Date;
}

export interface RateLimitsRow {
  key: string;
  window_start: Date;
  count: number;
}

export interface RecipeLinesRow {
  id: string;
  store_id: string;
  product_id: string;
  option_id: string | null;
  item_id: string;
  quantity: string;
}

export interface ReferralsRow {
  id: string;
  referrer_id: string;
  referred_id: string;
  referred_coupon_id: string | null;
  referrer_coupon_id: string | null;
  first_order_id: string | null;
  rewarded_at: Date | null;
  created_at: Date;
}

export interface RefundsRow {
  id: string;
  order_id: string;
  payment_id: string;
  amount_cents: number;
  store_share_cents: number;
  platform_share_cents: number;
  reason: string;
  requested_by: string | null;
  provider_refund_id: string | null;
  created_at: Date;
}

export interface ReviewEventsRow {
  id: string;
  review_id: string;
  action: string;
  old_rating: number | null;
  new_rating: number | null;
  reason: string;
  actor_id: string | null;
  created_at: Date;
}

export interface ReviewsRow {
  id: string;
  order_id: string;
  store_id: string;
  customer_id: string;
  rating: number;
  comment: string | null;
  reply: string | null;
  replied_at: Date | null;
  reported_at: Date | null;
  hidden_at: Date | null;
  hidden_by: string | null;
  hidden_reason: string | null;
  created_at: Date;
  report_reason: string | null;
  report_resolved_at: Date | null;
  report_resolved_by: string | null;
}

export interface SessionsRow {
  id: string;
  profile_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
}

export interface StockAlertsRow {
  id: string;
  store_id: string;
  item_id: string;
  lot_id: string | null;
  kind: StockAlertKind;
  detail: string | null;
  opened_at: Date;
  resolved_at: Date | null;
}

export interface StockItemsRow {
  id: string;
  store_id: string;
  name: string;
  category: string | null;
  sku: string | null;
  unit: StockUnit;
  quantity: string;
  min_quantity: string;
  ideal_quantity: string | null;
  unit_cost_cents: number | null;
  supplier: string | null;
  lead_time_days: number | null;
  storage_location: string | null;
  perishable: boolean;
  status: StockItemStatus;
  product_id: string | null;
  last_purchase_at: Date | null;
  last_movement_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface StockLotsRow {
  id: string;
  store_id: string;
  item_id: string;
  received_quantity: string;
  remaining_quantity: string;
  received_at: Date;
  manufactured_at: Date | null;
  expires_at: Date | null;
  supplier: string | null;
  cost_cents: number | null;
  discarded_at: Date | null;
  created_at: Date;
}

export interface StockMovementsRow {
  id: string;
  store_id: string;
  item_id: string;
  lot_id: string | null;
  kind: StockMovementKind;
  quantity: string;
  balance_after: string;
  reason: string | null;
  order_id: string | null;
  bill_item_id: string | null;
  created_by: string | null;
  process: string | null;
  created_at: Date;
}

export interface StoreClosingsRow {
  id: string;
  store_id: string;
  business_date: Date;
  status: ClosingStatus;
  order_count: number;
  fees_cents: number;
  credits_cents: number;
  adjustments_cents: number;
  total_due_cents: number;
  fee_unit_cents: number;
  due_date: Date;
  closed_at: Date;
  closed_by: string | null;
  paid_at: Date | null;
  review_reason: string | null;
}

export interface StoreClosuresRow {
  id: string;
  store_id: string;
  starts_at: Date;
  ends_at: Date;
  reason: string | null;
}

export interface StoreDeliveryAreasRow {
  store_id: string;
  neighborhood_id: string;
  delivery_fee_cents: number;
  min_minutes: number;
  max_minutes: number;
}

export interface StoreHoursRow {
  id: string;
  store_id: string;
  weekday: number;
  opens_at: string;
  closes_at: string;
  pickup_only: boolean;
}

export interface StoreInvitesRow {
  id: string;
  store_id: string;
  token_hash: string;
  full_name: string;
  phone: string | null;
  role: StoreMemberRole;
  permissions: string[] | null;
  expires_at: Date;
  used_at: Date | null;
  used_by: string | null;
  revoked_at: Date | null;
  created_by: string;
  created_at: Date;
}

export interface StoreMembersRow {
  store_id: string;
  profile_id: string;
  role: StoreMemberRole;
  created_at: Date;
  permissions: string[] | null;
  active: boolean;
  deactivated_at: Date | null;
  invited_by: string | null;
}

export interface StorePrintersRow {
  id: string;
  store_id: string;
  name: string;
  sector: PrinterSector;
  print_kind: PrintKind;
  paper_width_mm: number;
  copies: number;
  encoding: string;
  auto_print: boolean;
  auto_since: Date | null;
  is_default: boolean;
  device_id: string | null;
  device_label: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface StorePrivateRow {
  store_id: string;
  internal_phone: string | null;
  document_type: string | null;
  document_number: string | null;
  commission_rate: string;
  payment_recipient_id: string | null;
  cash_enabled: boolean;
  status_reason: string | null;
  approved_at: Date | null;
  approved_by: string | null;
  updated_at: Date;
  pix_key: string | null;
}

export interface StoreStatusEventsRow {
  id: string;
  store_id: string;
  kind: string;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  actor_id: string | null;
  process: string | null;
  created_at: Date;
}

export interface StoreStockSettingsRow {
  store_id: string;
  expiry_warning_days: number[];
  allow_negative: boolean;
  updated_at: Date;
}

export interface StoreSubcategoriesRow {
  store_id: string;
  subcategory_id: string;
}

export interface StoreSubscriptionsRow {
  id: string;
  store_id: string;
  plan_id: string;
  free_until: Date | null;
  active: boolean;
  started_at: Date;
}

export interface StoreSuspensionsRow {
  id: string;
  store_id: string;
  reason: string;
  description: string | null;
  starts_at: Date;
  ends_at: Date | null;
  notify_owner: boolean;
  previous_status: StoreStatus;
  applied_at: Date | null;
  created_by: string | null;
  created_at: Date;
  lifted_at: Date | null;
  lifted_by: string | null;
  lift_reason: string | null;
}

export interface StoreTablesRow {
  id: string;
  store_id: string;
  label: string;
  active: boolean;
  sort_order: number;
}

export interface StoresRow {
  id: string;
  city_id: string;
  category_id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string;
  street: string;
  number: string;
  neighborhood_id: string | null;
  reference: string | null;
  lat: string | null;
  lng: string | null;
  logo_url: string | null;
  cover_url: string | null;
  status: StoreStatus;
  manual_state: StoreManualState;
  paused_until: Date | null;
  pause_message: string | null;
  busy_extra_minutes: number;
  prep_time_minutes: number;
  min_order_cents: number;
  offers_delivery: boolean;
  offers_pickup: boolean;
  delivery_radius_km: string | null;
  accepts_scheduled: boolean;
  schedule_min_lead_minutes: number;
  schedule_max_days: number;
  same_day_cutoff: string | null;
  delivery_window_start: string | null;
  delivery_window_end: string | null;
  pizza_pricing: PizzaPricingRule;
  featured_until: Date | null;
  auto_print: boolean;
  printer_width_mm: number;
  rating_avg: string | null;
  rating_count: number;
  created_at: Date;
  updated_at: Date;
  delivery_provider: DeliveryProvider;
  accepts_pix: boolean;
  accepts_card: boolean;
  accepts_cash: boolean;
  closed_at: Date | null;
  closed_reason: string | null;
  closed_by_kind: string | null;
  closed_by: string | null;
}

export interface SubcategoriesRow {
  id: string;
  category_id: string;
  name: string;
  slug: string;
  group_name: string | null;
  sort_order: number;
  active: boolean;
}

export interface SubscriptionPlansRow {
  id: string;
  name: string;
  monthly_price_cents: number;
  active: boolean;
  created_at: Date;
}

export interface SupportTicketsRow {
  id: string;
  order_id: string;
  customer_id: string;
  store_id: string;
  reason: TicketReason;
  status: TicketStatus;
  photo_url: string | null;
  store_involved: boolean;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
}

export interface TableBillItemsRow {
  id: string;
  bill_id: string;
  product_id: string | null;
  name: string;
  unit_price_cents: number;
  quantity: number;
  notes: string | null;
  added_by: string;
  added_at: Date;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  options: unknown;
  lines: string[];
}

export interface TableBillPaymentsRow {
  id: string;
  bill_id: string;
  method: PaymentMethod;
  amount_cents: number;
  received_by: string;
  received_at: Date;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
}

export interface TableBillsRow {
  id: string;
  store_id: string;
  table_id: string | null;
  label: string;
  status: BillStatus;
  customer_name: string | null;
  opened_by: string;
  opened_at: Date;
  closed_by: string | null;
  closed_at: Date | null;
  cancel_reason: string | null;
  order_id: string | null;
}

export interface TicketMessagesRow {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_side: MessageSide;
  body: string;
  attachment_url: string | null;
  created_at: Date;
}

export interface WebhookEventsRow {
  id: string;
  provider: string;
  event_id: string;
  payload: unknown;
  received_at: Date;
  processed_at: Date | null;
}
