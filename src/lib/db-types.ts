// GENERATED FILE. Do not edit: run `npm run db:types` after changing migrations.

export type CouponType = "fixed" | "percent" | "free_delivery";
export type DiscountPayer = "platform" | "store";
export type FulfillmentType = "delivery" | "pickup";
export type InvoiceStatus = "open" | "paid" | "overdue" | "cancelled";
export type LedgerAccount = "store" | "platform";
export type LedgerDirection = "credit" | "debit";
export type LegalDocumentType = "terms" | "merchant_terms" | "privacy";
export type MessageChannel = "sms" | "whatsapp" | "email" | "push";
export type MessageSide = "customer" | "store" | "admin";
export type MissingItemPolicy = "call" | "substitute" | "remove";
export type OptionPriceMode = "sum" | "highest" | "average" | "free_up_to";
export type OrderStatus = "awaiting_payment" | "paid" | "accepted" | "preparing" | "ready" | "out_for_delivery" | "delivered" | "picked_up" | "expired" | "rejected" | "cancelled" | "refunded" | "partially_refunded";
export type PaymentMethod = "pix" | "card" | "cash";
export type PaymentStatus = "pending" | "approved" | "declined" | "expired" | "refunded" | "partially_refunded";
export type PizzaPricingRule = "highest" | "average";
export type ProductType = "standard" | "variant" | "service";
export type StoreManualState = "auto" | "open" | "closed";
export type StoreMemberRole = "owner" | "attendant" | "courier";
export type StoreStatus = "pending" | "active" | "paused" | "suspended";
export type TicketReason = "delay" | "missing_item" | "wrong_item" | "damaged_item" | "billing" | "other";
export type TicketStatus = "open" | "in_progress" | "waiting_customer" | "resolved";
export type UserRole = "customer" | "merchant" | "admin";

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
  customer_id: string;
  discount_cents: number;
  created_at: Date;
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
  customer_id: string;
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
}

export interface SessionsRow {
  id: string;
  profile_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
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

export interface StoreMembersRow {
  store_id: string;
  profile_id: string;
  role: StoreMemberRole;
  created_at: Date;
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
}

export interface StoreSubscriptionsRow {
  id: string;
  store_id: string;
  plan_id: string;
  free_until: Date | null;
  active: boolean;
  started_at: Date;
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
