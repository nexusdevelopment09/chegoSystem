import { sendOrderMessage } from "@/app/pedidos/more-actions";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { inputClass } from "@/components/ui/Field";
import { withUser } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

type Props = {
  orderId: string;
  viewerId: string;
  /** Which side the viewer is on, to align their own messages. */
  side: "customer" | "store";
  open: boolean;
};

/** Messages between the customer and the store about one order. */
export async function OrderChat({ orderId, viewerId, side, open }: Props) {
  // Read as the viewer: Row Level Security only shows the chat to the two sides of the order.
  const messages = await withUser(viewerId, (tx) => tx<{ id: string; sender_side: string; body: string; created_at: Date }[]>`
    select id, sender_side, body, created_at from order_messages where order_id = ${orderId} order by created_at`);

  return (
    <section className="rounded-card bg-white p-4 ring-1 ring-peach" data-testid="order-chat">
      <h2 className="mb-2 text-xl">{side === "customer" ? "Mensagens com a loja" : "Mensagens com o cliente"}</h2>

      {messages.length === 0 ? (
        <p className="text-sm text-coffee-soft">Nenhuma mensagem ainda.</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-2" aria-live="polite">
          {messages.map((message) => {
            const mine = message.sender_side === side;
            return (
              <li key={message.id} className={`max-w-[85%] rounded-2xl px-3 py-2 ${mine ? "self-end bg-peach" : "self-start bg-cream"}`}>
                <p className="text-xs font-bold text-coffee-soft">
                  {mine ? "Você" : message.sender_side === "store" ? "Loja" : "Cliente"} · {formatDateTime(message.created_at)}
                </p>
                {/* Plain text: whatever is typed is shown as text, never as HTML. */}
                <p className="whitespace-pre-wrap break-words">{message.body}</p>
              </li>
            );
          })}
        </ul>
      )}

      {open ? (
        <ActionForm action={sendOrderMessage} resetOnSuccess className="flex flex-col gap-2">
          <input type="hidden" name="orderId" value={orderId} />
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Escrever mensagem
            <textarea name="body" required maxLength={500} rows={2} className={`${inputClass} py-3 font-normal`} />
          </label>
          <SubmitButton variant="secondary" className="min-h-11 self-start px-4 text-sm">Enviar</SubmitButton>
          <p className="text-xs text-coffee-soft">Por segurança, telefones, links e redes sociais não podem ser enviados por aqui.</p>
        </ActionForm>
      ) : (
        <p className="text-sm text-coffee-soft">As mensagens deste pedido estão encerradas.</p>
      )}
    </section>
  );
}
