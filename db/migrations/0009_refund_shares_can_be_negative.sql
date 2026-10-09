-- When the platform paid for a coupon bigger than what it earned on the
-- order, its share of the sale is negative, and so is its share of a refund
-- (it gets the coupon money back). Only the sum has to match the refund.

alter table refunds
  drop constraint refunds_store_share_cents_check,
  drop constraint refunds_platform_share_cents_check;
