// Local PostgreSQL without Docker. The server binaries come from the
// @embedded-postgres npm package and the data lives in .db/ (git-ignored).
//
//   node scripts/db.ts start    start the server and apply pending migrations
//   node scripts/db.ts stop     stop the server (data is kept)
//   node scripts/db.ts status   tell whether the server is running
//   node scripts/db.ts migrate  apply pending migrations
//   node scripts/db.ts reset    drop everything, re-run migrations and the seed
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { seed } from "../db/seed.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "node_modules", "@embedded-postgres", "windows-x64", "native", "bin");
const DB_DIR = join(ROOT, ".db");
const DATA_DIR = join(DB_DIR, "data");
const LOG_FILE = join(DB_DIR, "postgres.log");
const MIGRATIONS_DIR = join(ROOT, "db", "migrations");

const PORT = 54329;
const USER = "chego";
const DATABASE = "chego";
const url = (database: string) => `postgres://${USER}@127.0.0.1:${PORT}/${database}`;

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
  // "trust" is fine here: the server only listens on this computer.
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
  await migrate();
}

function stop() {
  if (!existsSync(DATA_DIR) || !isRunning()) {
    console.log("O banco já estava desligado.");
    return;
  }
  run("pg_ctl.exe", ["stop", "-D", DATA_DIR, "-m", "fast", "-w"], true);
  console.log("Banco desligado. Os dados continuam guardados.");
}

async function reset() {
  await start();
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

const command = process.argv[2];
try {
  if (command === "start") await start();
  else if (command === "stop") stop();
  else if (command === "migrate") await migrate();
  else if (command === "reset") await reset();
  else if (command === "status") {
    console.log(existsSync(DATA_DIR) && isRunning() ? `Ligado em localhost:${PORT}.` : "Desligado.");
  } else {
    console.log("Use: start | stop | status | migrate | reset");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
