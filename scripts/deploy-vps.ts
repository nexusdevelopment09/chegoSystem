// Envia o Chegô para a VPS e liga com Docker, sem precisar de GitHub.
//
//   npm run deploy:vps -- root@203.0.113.10
//   npm run deploy:vps -- root@203.0.113.10 /opt/chego
//
// Empacota os arquivos do projeto (os mesmos que o git enxerga, incluindo os ainda
// não commitados, mas nunca o que está no .gitignore, como .env.local, .db e storage),
// manda por scp e, na VPS, troca os arquivos da pasta mantendo o .env e roda
// `docker compose up -d --build`. Banco e fotos ficam em volumes do Docker e não são tocados.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [server, remoteDir = "/opt/chego"] = process.argv.slice(2);

if (!server) {
  console.log("Use: npm run deploy:vps -- usuario@ip-da-vps [/pasta/na/vps]");
  process.exit(1);
}
// A pasta na VPS é esvaziada a cada envio, então só aceita uma pasta própria do Chegô.
if (!/^\/[\w./-]+$/.test(remoteDir) || !basename(remoteDir).includes("chego")) {
  console.error(`Pasta da VPS recusada: "${remoteDir}". Use um caminho absoluto cuja última parte tenha "chego", como /opt/chego.`);
  process.exit(1);
}

function run(command: string, args: string[], options: { capture?: boolean } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw new Error(`Não consegui rodar ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} terminou com erro (código ${result.status}).`);
  return result.stdout ?? "";
}

const work = mkdtempSync(join(tmpdir(), "chego-deploy-"));
const archive = join(work, "chego.tar.gz");
const remoteArchive = "/tmp/chego-release.tar.gz";

try {
  const files = run("git", ["-c", "core.quotepath=off", "ls-files", "-co", "--exclude-standard"], { capture: true })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const list = join(work, "files.txt");
  writeFileSync(list, files.join("\n") + "\n", "utf8");

  console.log(`Empacotando ${files.length} arquivos...`);
  run("tar", ["-czf", archive, "-T", list]);

  console.log(`Enviando para ${server}...`);
  run("scp", [archive, `${server}:${remoteArchive}`]);

  console.log("Atualizando e ligando na VPS (o primeiro build leva alguns minutos)...");
  const script = [
    "set -e",
    `mkdir -p '${remoteDir}'`,
    `cd '${remoteDir}'`,
    `find . -mindepth 1 -maxdepth 1 ! -name .env -exec rm -rf {} +`,
    `tar -xzf ${remoteArchive}`,
    `rm -f ${remoteArchive}`,
    `if [ ! -f .env ]; then echo; echo "Falta o arquivo .env em ${remoteDir}. Copie .env.vps.example para .env, preencha e rode de novo."; exit 1; fi`,
    "docker compose up -d --build",
    "docker image prune -f > /dev/null",
    "docker compose ps",
  ].join(" && ");
  run("ssh", [server, script]);

  console.log("\nPronto. Acompanhe os registros com: ssh " + server + ` "cd ${remoteDir} && docker compose logs -f app"`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
