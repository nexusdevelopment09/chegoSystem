import type { Metadata } from "next";
import { PartnerLogin } from "../LoginChooser";

export const metadata: Metadata = { title: "Entrar como lojista" };

export default function StoreLoginPage() {
  return (
    <PartnerLogin
      title="Área do lojista"
      text="Dono, atendente ou entregador da loja: entre com o seu telefone e a sua senha."
      signupQuestion="Ainda não vende no Chegô?"
      signupHref="/quero-vender"
      signupLabel="Cadastrar minha loja"
      area="store"
    />
  );
}
