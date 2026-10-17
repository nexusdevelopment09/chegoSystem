# O que falta para ir ao ar (futuro)

**Nada disto foi feito.** O Chegô roda hoje só neste computador, com pagamento simulado. Este documento é uma lista do que precisa ser decidido e feito antes de atender clientes de verdade. Nada deve ser publicado sem a sua autorização.

## 1. Decisões que são suas

| Decisão | Por que importa |
|---|---|
| Qual gateway de pagamento usar | Precisa ter Pix, cartão e divisão automática do valor entre loja e plataforma (split). As taxas mudam a conta da comissão. |
| Empresa e CNPJ da plataforma | O gateway e as lojas fazem contrato com uma empresa. |
| Textos legais | Os termos de uso e a política de privacidade do sistema são rascunhos e precisam ser revistos por um advogado (LGPD, Código de Defesa do Consumidor). |
| Onde hospedar | O app e o banco PostgreSQL precisam de um servidor na nuvem, com cópia de segurança diária. |
| Quem envia SMS, WhatsApp e e-mail | Hoje as mensagens são só simuladas. O código de login por SMS depende disso. |
| Endereço do site (domínio) | Por exemplo, o endereço que vai nos cartazes das lojas. |

## 2. Trabalho técnico

0. **Provedor Pix das taxas do Chegô.** Escolher o provedor (Asaas, Mercado Pago, Efí...), abrir a conta da empresa e escrever o provedor em `src/lib/fees/pix.ts` seguindo a documentação oficial dele (criação da cobrança, webhook assinado e consulta para conciliação). Configurar `FEE_PIX_PROVIDER` e os segredos no `.env` da VPS e testar no ambiente de testes (sandbox) do provedor antes de valer de verdade.
1. **Gateway real em modo de teste (Etapa 14), se um dia o cliente for pagar pelo app.** Escrever um novo provedor de pagamento ao lado do simulado (`src/lib/payments/`). O resto do sistema não muda, porque só conversa com a interface `PaymentProvider`. Rodar todos os testes de pagamento contra o ambiente de teste do gateway.
2. **Envio real de mensagens.** Trocar o envio simulado (`src/lib/notifications/outbound.ts`) por um fornecedor de SMS, WhatsApp e e-mail.
3. **Login.** Hoje é por telefone e senha, e quem esquece a senha pede uma provisória ao admin. Com SMS ou WhatsApp de verdade, dá para acrescentar "esqueci a senha" por código. No servidor, o admin é criado pelo `.env` (`ADMIN_EMAIL`, `ADMIN_PASSWORD`), e `LOGIN_USERNAME_DOMAIN` não deve existir.
4. **Banco.** Criar o PostgreSQL na nuvem, aplicar as migrations e **não** rodar o seed (ele só cria dados fictícios).
5. **Fotos.** Hoje ficam na pasta `storage/` do computador. Em produção, usar um serviço de armazenamento de arquivos.
6. **Tarefas agendadas.** Hoje um relógio dentro do app chama as tarefas a cada minuto. Em produção, usar o agendador do servidor chamando `POST /api/tarefas`.
7. **Segredos.** Chaves do gateway, do banco e do push ficam só nas variáveis de ambiente do servidor, nunca no código.
8. **Página `/dev` e relógio simulado.** Já ficam desligados fora do ambiente local. Conferir isso no servidor antes de abrir ao público.
9. **Monitoramento.** Registrar erros e ter um alerta quando o webhook de pagamento falhar.

## 3. Antes de abrir para os clientes

- Fazer o [roteiro de testes](ROTEIRO_DE_TESTES.md) inteiro no servidor, com pagamentos de valor baixo de verdade.
- Cadastrar as lojas reais (os dados de hoje são todos fictícios).
- Testar o reembolso e a conciliação com o extrato do gateway.
- Começar com poucas lojas e acompanhar a página **Ao vivo** do admin.
