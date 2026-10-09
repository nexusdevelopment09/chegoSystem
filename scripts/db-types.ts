// Generates src/lib/db-types.ts from the local database, so the TypeScript
// types always match the migrations. Run with: npm run db:types
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "db-types.ts");
const sql = postgres(process.env.DATABASE_URL ?? "postgres://chego@127.0.0.1:54329/chego", {
  max: 1,
  onnotice: () => {},
});

// How the `postgres` driver hands each column type to JavaScript.
const BASE_TYPES: Record<string, string> = {
  uuid: "string",
  text: "string",
  varchar: "string",
  bpchar: "string",
  time: "string",
  numeric: "string",
  int2: "number",
  int4: "number",
  bool: "boolean",
  date: "Date",
  timestamptz: "Date",
  jsonb: "unknown",
};

const pascal = (name: string) =>
  name.replace(/(^|_)([a-z])/g, (_match, _sep, letter: string) => letter.toUpperCase());

try {
  const enums = await sql<{ name: string; labels: string[] }[]>`
    select t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
    group by t.typname
    order by t.typname`;
  const enumNames = new Set(enums.map((item) => item.name));

  const columns = await sql<{ table_name: string; column_name: string; udt_name: string; is_nullable: string }[]>`
    select table_name, column_name, udt_name, is_nullable
    from information_schema.columns
    where table_schema = 'public' and table_name <> 'schema_migrations'
    order by table_name, ordinal_position`;

  const tsType = (udt: string): string => {
    if (udt.startsWith("_")) return `${tsType(udt.slice(1))}[]`;
    if (enumNames.has(udt)) return pascal(udt);
    const mapped = BASE_TYPES[udt];
    if (!mapped) throw new Error(`Tipo do banco sem mapeamento: ${udt}`);
    return mapped;
  };

  const lines = [
    "// GENERATED FILE. Do not edit: run `npm run db:types` after changing migrations.",
    "",
  ];

  for (const item of enums) {
    lines.push(`export type ${pascal(item.name)} = ${item.labels.map((label) => `"${label}"`).join(" | ")};`);
  }

  let current = "";
  for (const column of columns) {
    if (column.table_name !== current) {
      if (current) lines.push("}");
      current = column.table_name;
      lines.push("", `export interface ${pascal(current)}Row {`);
    }
    const nullable = column.is_nullable === "YES" ? " | null" : "";
    lines.push(`  ${column.column_name}: ${tsType(column.udt_name)}${nullable};`);
  }
  if (current) lines.push("}");

  writeFileSync(OUT, `${lines.join("\n")}\n`);
  console.log(`Tipos gerados em src/lib/db-types.ts (${new Set(columns.map((c) => c.table_name)).size} tabelas).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
