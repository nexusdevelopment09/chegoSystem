import type { Metadata } from "next";
import { PartnerLogin } from "../LoginChooser";

export const metadata: Metadata = { title: "Entrar como entregador" };

export default function CourierLoginPage() {
  return (
    <PartnerLogin
      title="Área do entregador"
      text="Entregador do Chegô ou parceiro: entre com o seu telefone e a sua senha."
      signupQuestion="Quer entregar pelo Chegô?"
      signupHref="/quero-entregar"
      signupLabel="Quero ser entregador"
    />
  );
}
