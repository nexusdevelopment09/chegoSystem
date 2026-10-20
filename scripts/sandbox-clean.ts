// Apaga só a caixa de areia financeira (a cidade sintética e o que pertence a ela).
// Recusa rodar fora do ambiente de testes ou num banco que não seja desta máquina.
//   npm run sandbox:fees:clean
import postgres from "postgres";
import { assertSandboxAllowed, cleanSandbox } from "../tests/simulation/sandbox.ts";

assertSandboxAllowed({ APP_ENV: process.env.APP_ENV, DATABASE_URL: process.env.DATABASE_URL });
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
try {
  await cleanSandbox(sql);
  console.log("Caixa de areia financeira apagada. Nada fora dela foi tocado.");
} finally {
  await sql.end();
}
