import { Field } from "@/components/ui/Field";

/**
 * Nos cadastros de loja e de entregador: quem ainda não tem conta cria a senha ali
 * mesmo. Quem já entrou usa a própria conta (com o mesmo telefone) e não cria outra.
 */
export function AccountPasswordField({ signedInAs, purpose }: { signedInAs: string | null; purpose: string }) {
  if (signedInAs) {
    return (
      <p className="rounded-2xl bg-peach px-4 py-3 text-sm text-coffee">
        Você entrou como <strong>{signedInAs}</strong>. Use o telefone da sua conta: o cadastro fica ligado a ela e você
        continua entrando com a mesma senha.
      </p>
    );
  }
  return (
    <Field
      label="Crie uma senha"
      name="password"
      type="password"
      autoComplete="new-password"
      required
      minLength={8}
      maxLength={72}
      hint={`Pelo menos 8 caracteres. ${purpose}`}
    />
  );
}
