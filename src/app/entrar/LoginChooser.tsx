import Link from "next/link";
import { LogoIcon } from "@/components/brand/LogoIcon";
import { buttonClass } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { isLocalEnv } from "@/lib/env";
import { PhonePasswordForm } from "./PhonePasswordForm";

/**
 * A porta de entrada do Chegô (em /entrar e na primeira visita): o cliente em
 * destaque, e lojista e entregador logo abaixo, cada um com a sua área.
 */
export function LoginChooser() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <LogoIcon size={88} title="Chegô" />
        <div>
          <h1 className="text-3xl">Pediu, Chegô.</h1>
          <p className="text-coffee-soft">Tudo da cidade, numa sacola só.</p>
        </div>
      </div>

      <section aria-labelledby="customer-login" className="flex flex-col gap-4 rounded-card bg-white p-6 shadow-sm ring-1 ring-peach">
        <div>
          <h2 id="customer-login" className="text-2xl">Entrar para pedir</h2>
          <p className="text-sm text-coffee-soft">Use o telefone e a senha da sua conta.</p>
        </div>
        <PhonePasswordForm />
        <Link href="/entrar/criar-conta" className={buttonClass("secondary")}>
          Criar minha conta
        </Link>
        <p className="text-center text-sm text-coffee-soft">
          Esqueceu a senha? Peça uma nova ao suporte do Chegô.
        </p>
      </section>

      <Link href="/" className="text-center text-sm font-semibold text-brand-dark underline">
        Só quero ver as lojas
      </Link>

      <section aria-labelledby="partner-login" className="flex flex-col gap-3">
        <h2 id="partner-login" className="text-center text-base font-bold text-coffee-soft">É parceiro do Chegô?</h2>
        <div className="grid grid-cols-2 gap-3">
          <PartnerLink href="/entrar/loja" icon="store" title="Sou lojista" note="Painel da loja" />
          <PartnerLink href="/entrar/entregador" icon="bike" title="Sou entregador" note="Minhas entregas" />
        </div>
      </section>

      {isLocalEnv && (
        <p className="rounded-2xl bg-peach px-4 py-3 text-center text-sm text-coffee">
          Neste computador: telefone <strong>0000</strong> e senha <strong>0000</strong> entram na conta de demonstração.
          Os usuários de teste também entram com a senha <strong>123456</strong>, ou pelo{" "}
          <Link href="/dev" className="font-bold underline">login rápido</Link>.
        </p>
      )}

      <Link href="/entrar/senha" className="text-center text-xs text-coffee-soft underline">
        Equipe Chegô
      </Link>
    </main>
  );
}

function PartnerLink({ href, icon, title, note }: { href: string; icon: IconName; title: string; note: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-card bg-white p-3 text-center shadow-sm ring-1 ring-peach transition-colors hover:bg-peach/40"
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-peach text-brand-darker">
        <Icon name={icon} size={22} />
      </span>
      <span className="font-bold">{title}</span>
      <span className="text-xs text-coffee-soft">{note}</span>
    </Link>
  );
}

/** Entrada própria de lojistas e entregadores: o mesmo telefone e senha, com o caminho para se cadastrar. */
export function PartnerLogin({ title, text, signupHref, signupQuestion, signupLabel, area }: {
  title: string; text: string; signupHref: string; signupQuestion: string; signupLabel: string; area: "store" | "courier";
}) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <Link href="/entrar" aria-label="Voltar para a entrada do Chegô" className="self-center">
        <LogoIcon size={64} title="Chegô" />
      </Link>

      <section className="flex flex-col gap-4 rounded-card bg-white p-6 shadow-sm ring-1 ring-peach">
        <div>
          <h1 className="text-2xl">{title}</h1>
          <p className="text-sm text-coffee-soft">{text}</p>
        </div>
        <PhonePasswordForm autoFocus area={area} />
        <p className="text-center text-sm text-coffee-soft">
          Esqueceu a senha? Peça uma nova ao suporte do Chegô.
        </p>
        {isLocalEnv && (
          <p className="rounded-2xl bg-peach px-4 py-3 text-center text-sm text-coffee">
            Neste computador: telefone <strong>0000</strong> e senha <strong>0000</strong> entram na conta de demonstração.
          </p>
        )}
      </section>

      <div className="flex flex-col items-center gap-2 text-center text-sm">
        <span className="text-coffee-soft">{signupQuestion}</span>
        <Link href={signupHref} className={buttonClass("secondary", "w-full")}>{signupLabel}</Link>
      </div>

      <Link href="/entrar" className="text-center text-sm font-semibold text-brand-dark underline">
        Voltar
      </Link>
    </main>
  );
}
