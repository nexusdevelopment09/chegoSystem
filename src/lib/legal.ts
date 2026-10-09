import "server-only";
import { sql } from "@/lib/db";

export type LegalType = "terms" | "merchant_terms" | "privacy";

export type LegalDocument = {
  id: string;
  type: LegalType;
  version: number;
  title: string;
  content: string;
  publishedAt: Date;
};

type LegalRow = { id: string; type: LegalType; version: number; title: string; content: string; published_at: Date };

const toDocument = (row: LegalRow): LegalDocument => ({
  id: row.id, type: row.type, version: row.version, title: row.title, content: row.content, publishedAt: row.published_at,
});

export const LEGAL_SLUGS: Record<string, LegalType> = {
  uso: "terms",
  lojista: "merchant_terms",
  privacidade: "privacy",
};

/** "terms" -> "uso": the public address of a document type. */
export const slugOfLegalType = (type: LegalType) =>
  Object.entries(LEGAL_SLUGS).find(([, value]) => value === type)![0];

/** Latest published version of each document. */
export async function currentLegalDocuments(): Promise<LegalDocument[]> {
  const rows = await sql<LegalRow[]>`
    select distinct on (type) id, type, version, title, content, published_at
    from legal_documents
    where published_at is not null and published_at <= now()
    order by type, version desc`;
  return rows.map(toDocument);
}

/** Which types a user has to accept: merchants also accept the merchant terms. */
function requiredTypes(role: string): LegalType[] {
  return role === "merchant" ? ["terms", "privacy", "merchant_terms"] : ["terms", "privacy"];
}

/** Current documents the user has not accepted yet (new user or new version). */
export async function pendingLegalDocuments(profileId: string, role: string): Promise<LegalDocument[]> {
  const rows = await sql<LegalRow[]>`
    select d.id, d.type, d.version, d.title, d.content, d.published_at
    from (
      select distinct on (type) *
      from legal_documents
      where published_at is not null and published_at <= now()
      order by type, version desc
    ) d
    where d.type::text = any(${requiredTypes(role)})
      and not exists (
        select 1 from legal_acceptances a
        where a.document_id = d.id and a.profile_id = ${profileId}
      )
    order by d.type`;
  return rows.map(toDocument);
}

/** Records the acceptance, with date and version, of everything pending. */
export async function acceptPendingLegalDocuments(profileId: string, role: string) {
  const pending = await pendingLegalDocuments(profileId, role);
  if (pending.length === 0) return;

  await sql.begin(async (tx) => {
    for (const document of pending) {
      await tx`
        insert into legal_acceptances (profile_id, document_id)
        values (${profileId}, ${document.id})
        on conflict (profile_id, document_id) do nothing`;
    }
    await tx`update profiles set accepted_terms_at = now() where id = ${profileId}`;
  });
}
