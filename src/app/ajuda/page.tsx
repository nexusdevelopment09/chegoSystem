import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/SiteHeader";

export const metadata: Metadata = { title: "Ajuda" };

const QUESTIONS = [
  ["Como eu pago?", "Dentro do app, com Pix ou cartão de crédito. O pedido só vai para a loja depois que o pagamento é confirmado."],
  ["Quanto tempo demora?", "Cada loja mostra o tempo estimado para o seu bairro ou comunidade antes de você pedir. Dá para acompanhar tudo em “Pedidos”."],
  ["Posso cancelar?", "Pode, enquanto a loja ainda não aceitou. O valor volta inteiro. Depois disso, fale com a gente em “Preciso de ajuda”, dentro do pedido."],
  ["A loja recusou meu pedido. E o dinheiro?", "É devolvido automaticamente, do mesmo jeito que você pagou."],
  ["Para que serve o código de entrega?", "São 4 números que aparecem no seu pedido. Diga ao entregador quando ele chegar: é a prova de que o pedido foi entregue para você."],
  ["Veio item faltando ou errado.", "Abra o pedido, toque em “Preciso de ajuda”, escolha o motivo e, se puder, mande uma foto. A equipe do Chegô resolve com a loja."],
  ["Por que não posso mandar meu telefone nas mensagens?", "Para a sua segurança e a da loja, a conversa do pedido fica toda dentro do app."],
  ["Moro na zona rural. Entregam aí?", "Algumas lojas entregam nas comunidades rurais. Escolha a sua comunidade e o app mostra quem atende e a taxa. Coloque sempre um ponto de referência no endereço."],
  ["Tenho uma loja. Como vendo no Chegô?", "Toque em “Quero vender no Chegô” no fim da página inicial e preencha o cadastro. A gente analisa e libera."],
];

export default function HelpPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10">
        <h1 className="mb-4 text-3xl">Ajuda</h1>
        <div className="flex flex-col gap-2">
          {QUESTIONS.map(([question, answer]) => (
            <details key={question} className="rounded-card bg-white p-4 ring-1 ring-peach">
              <summary className="min-h-11 cursor-pointer font-semibold">{question}</summary>
              <p className="mt-2 text-coffee-soft">{answer}</p>
            </details>
          ))}
        </div>
        <p className="mt-6 text-center">
          <Link href="/pedidos" className="font-bold text-brand-dark underline">Ver meus pedidos</Link>
        </p>
      </main>
    </>
  );
}
