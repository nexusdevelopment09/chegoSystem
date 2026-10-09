import "server-only";
import type postgres from "postgres";

/** Store rating = average of the visible reviews of the last 180 days. */
export async function recalculateRating(db: postgres.Sql | postgres.TransactionSql, storeId: string, at: Date) {
  await db`
    update stores s set
      rating_count = (select count(*) from reviews r where r.store_id = s.id and r.hidden_at is null and r.created_at > ${at}::timestamptz - interval '180 days'),
      rating_avg = (select round(avg(r.rating), 2) from reviews r where r.store_id = s.id and r.hidden_at is null and r.created_at > ${at}::timestamptz - interval '180 days')
    where s.id = ${storeId}`;
}
