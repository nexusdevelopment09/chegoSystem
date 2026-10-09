import { isLocalEnv } from "@/lib/env";

export function EnvBanner() {
  if (!isLocalEnv) return null;

  return (
    <div
      role="status"
      className="bg-coffee px-4 py-1 text-center text-xs font-semibold tracking-wide text-peach print:hidden"
    >
      Ambiente de testes
    </div>
  );
}
