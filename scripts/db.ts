// PostgreSQL local sem Docker. Os binários do servidor vêm do pacote npm
// @embedded-postgres e os dados ficam em .db/ (ignorada pelo git).
//
//   node scripts/db.ts start    liga o servidor e aplica as migrations pendentes
//   node scripts/db.ts stop     desliga o servidor (os dados ficam guardados)
//   node scripts/db.ts status   diz se o servidor está ligado
//   node scripts/db.ts migrate  aplica as migrations pendentes
//   node scripts/db.ts reset    apaga tudo e roda de novo as migrations e o seed
//   node scripts/db.ts bootstrap  como start; com SEED_IF_EMPTY=1, roda o seed se o banco estiver vazio
//
// Com DB_MODE=external (o servidor com Docker), o PostgreSQL já roda em outro
// contêiner: o script não liga nem desliga nada e usa o endereço do DATABASE_URL.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { seed } from "../db/seed/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "node_modules", "@embedded-postgres", "windows-x64", "native", "bin");
const DB_DIR = join(ROOT, ".db");
const DATA_DIR = join(DB_DIR, "data");
const LOG_FILE = join(DB_DIR, "postgres.log");
const MIGRATIONS_DIR = join(ROOT, "db", "migrations");

const PORT = 54329;
const USER = "chego";
// Os testes automáticos usam o próprio banco (CHEGO_DB=chego_test), então
// nunca mexem nos dados que você está testando à mão.
const EXTERNAL = process.env.DB_MODE === "external";
const EXTERNAL_URL = EXTERNAL ? new URL(process.env.DATABASE_URL ?? "") : null;
const DATABASE = process.env.CHEGO_DB ?? (EXTERNAL_URL ? EXTERNAL_URL.pathname.slice(1) : "chego");

function url(database: string) {
  if (!EXTERNAL_URL) return `postgres://${USER}@127.0.0.1:${PORT}/${database}`;
  const external = new URL(EXTERNAL_URL);
  external.pathname = `/${database}`;
  return external.toString();
}

function run(exe: string, args: string[], quiet = false) {
  const result = spawnSync(join(BIN, exe), args, {
    stdio: quiet ? "ignore" : "inherit",
    windowsHide: true,
  });
  return result.status ?? 1;
}

const isRunning = () => run("pg_ctl.exe", ["status", "-D", DATA_DIR], true) === 0;

function initCluster() {
  if (existsSync(join(DATA_DIR, "PG_VERSION"))) return;
  if (!existsSync(BIN)) {
    throw new Error("PostgreSQL não encontrado. Rode `npm install` primeiro.");
  }
  mkdirSync(DB_DIR, { recursive: true });
  console.log("Criando o banco pela primeira vez...");
  // "trust" serve aqui: o servidor só escuta neste computador.
  const status = run("initdb.exe", ["-D", DATA_DIR, "-U", USER, "-A", "trust", "-E", "UTF8", "--locale=C"], true);
  if (status !== 0) throw new Error("Não consegui criar o banco (initdb falhou).");
  appendFileSync(
    join(DATA_DIR, "postgresql.conf"),
    `\n# Chegô\nport = ${PORT}\nlisten_addresses = 'localhost'\ntimezone = 'America/Maceio'\n`,
  );
}

async function ensureDatabase() {
  const admin = postgres(url("postgres"), { max: 1, onnotice: () => {} });
  try {
    const found = await admin`select 1 from pg_database where datname = ${DATABASE}`;
    if (found.length === 0) await admin.unsafe(`create database ${DATABASE}`);
  } finally {
    await admin.end();
  }
}

async function migrate() {
  const sql = postgres(url(DATABASE), { max: 1, onnotice: () => {} });
  try {
    await sql`create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`;
    const applied = new Set((await sql`select name from schema_migrations`).map((row) => row.name));
    const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      await sql.begin(async (tx) => {
        await tx.unsafe(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
        await tx`insert into schema_migrations (name) values (${file})`;
      });
      console.log(`  migration aplicada: ${file}`);
    }
  } finally {
    await sql.end();
  }
}

async function start() {
  await boot();
  await migrate();
}

/** Liga o servidor e garante que o banco existe. */
async function boot() {
  if (EXTERNAL) {
    await waitForExternal();
    await ensureDatabase();
    return;
  }
  initCluster();
  if (isRunning()) {
    console.log("O banco já estava ligado.");
  } else {
    const status = run("pg_ctl.exe", ["start", "-D", DATA_DIR, "-l", LOG_FILE, "-w"], true);
    if (status !== 0) {
      throw new Error(`O banco não ligou. Veja o motivo em ${LOG_FILE}`);
    }
    console.log(`Banco ligado em localhost:${PORT}.`);
  }
  await ensureDatabase();
}

/** O contêiner do banco pode levar alguns segundos para aceitar conexões depois de ligar. */
async function waitForExternal() {
  for (let attempt = 1; ; attempt++) {
    const admin = postgres(url("postgres"), { max: 1, connect_timeout: 5, onnotice: () => {} });
    try {
      await admin`select 1`;
      return;
    } catch (error) {
      if (attempt >= 30) throw new Error(`O banco não respondeu em ${EXTERNAL_URL!.host}: ${(error as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } finally {
      await admin.end();
    }
  }
}

function stop() {
  if (EXTERNAL) {
    console.log("Com DB_MODE=external o banco é desligado pelo Docker (docker compose stop db).");
    return;
  }
  if (!existsSync(DATA_DIR) || !isRunning()) {
    console.log("O banco já estava desligado.");
    return;
  }
  run("pg_ctl.exe", ["stop", "-D", DATA_DIR, "-m", "fast", "-w"], true);
  console.log("Banco desligado. Os dados continuam guardados.");
}

async function reset() {
  await boot();
  const admin = postgres(url("postgres"), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ${DATABASE} with (force)`);
    await admin.unsafe(`create database ${DATABASE}`);
  } finally {
    await admin.end();
  }
  await migrate();

  const sql = postgres(url(DATABASE), { max: 1, onnotice: () => {} });
  try {
    await seed(sql);
  } finally {
    await sql.end();
  }
  console.log("Banco recriado com os dados de teste.");
}

/** Usado ao ligar o contêiner do app: migrations sempre; dados de teste só na primeira vez. */
async function bootstrap() {
  await start();
  if (process.env.SEED_IF_EMPTY !== "1") return;

  const sql = postgres(url(DATABASE), { max: 1, onnotice: () => {} });
  try {
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from profiles`;
    if (count > 0) return;
    await seed(sql);
    console.log("Banco vazio: dados de teste criados.");
  } finally {
    await sql.end();
  }
}

const command = process.argv[2];
try {
  if (command === "start") await start();
  else if (command === "bootstrap") await bootstrap();
  else if (command === "stop") stop();
  else if (command === "migrate") await migrate();
  else if (command === "reset") await reset();
  else if (command === "status") {
    if (EXTERNAL) {
      await waitForExternal();
      console.log(`Ligado em ${EXTERNAL_URL!.host}.`);
    } else {
      console.log(existsSync(DATA_DIR) && isRunning() ? `Ligado em localhost:${PORT}.` : "Desligado.");
    }
  } else {
    console.log("Use: start | stop | status | migrate | reset | bootstrap");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
