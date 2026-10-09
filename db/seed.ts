// Development seed, applied by `npm run db:reset`. Never run in production.
// The full seed (cities, stores, menus, orders...) comes in Etapa 2.
import type { Sql } from "postgres";
import { hashPassword } from "../src/lib/auth/password.ts";

export async function seed(sql: Sql) {
  // Admin: user "admin" (admin@chego.local), password "admin".
  await sql`
    insert into profiles (full_name, phone, email, password_hash, role, accepted_terms_at)
    values (
      'Admin Chegô', '+5582900000000', 'admin@chego.local',
      ${hashPassword("admin")}, 'admin', now()
    )
  `;
}
