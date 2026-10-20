# Impressão térmica Bluetooth (58 mm) — Chegô

## Como funciona (arquitetura escolhida)

O Chegô continua sendo uma PWA. A impressão usa a **Web Serial API do Chrome para Android**, que fala com impressoras **Bluetooth Classic já pareadas** pelo perfil serial **SPP/RFCOMM** (UUID `00001101-0000-1000-8000-00805f9b34fb`). Não é Web Bluetooth (que só fala com aparelhos BLE) e não precisa de aplicativo auxiliar.

Por que esta e não as outras opções do pedido:

- **A (direto pelo navegador): escolhida.** O Chrome para Android passou a suportar Web Serial por Bluetooth RFCOMM em 2025 ("Intent to Ship: Web serial over Bluetooth on Android", blink-dev). É a menor mudança possível: sem instalar nada além do Chrome, sem servidor local no celular.
- **B (aplicativo auxiliar Android):** não foi necessário. Também evita os riscos de um servidor local no celular (porta aberta, origem, certificado).
- **C (empacotar com Capacitor):** fica como plano B se algum modelo de impressora não funcionar pela Web Serial.

Fluxo:

```
Celular Android (Chrome, painel da loja)          Servidor Chegô                      Banco
──────────────────────────────────────────          ─────────────────                    ─────
PrintStation (a cada 8 s ou na hora)  ── POST /api/impressao {claim} ──▶ cria os trabalhos      print_jobs
                                                                         automáticos que faltam   (único por
                                                                         e pega até 5 de forma    impressora,
                                       ◀── bytes ESC/POS do cupom ─────  atômica (skip locked)    pedido, tipo)
envia pelo Bluetooth (Web Serial)
                                      ── POST /api/impressao {finish} ─▶ enviado / falhou
```

- **Bytes do cupom no servidor** (`src/lib/printing/receipt.ts`, `escpos.ts`): o pedido é lido com as permissões de quem está logado (`loadOrder`, RLS) e só da própria loja. Nada de dado fictício: só campos que existem no pedido.
- **Conexão no aparelho** (`src/lib/printing/bridge.ts`): nada de sessão Bluetooth no banco. O banco guarda só as preferências e em qual aparelho (`device_id`, um número aleatório que o próprio aparelho guarda) cada impressora foi conectada. O Chrome lembra a permissão; reabrir o painel reconecta sem toque.
- **Fila sem duplicar** (`src/lib/printing/jobs.ts`): índice único `(impressora, pedido, tipo)` para a impressão automática; pegar um trabalho o tira da fila na mesma consulta (`for update skip locked`). Recarregar, abrir duas abas, reconectar ou receber o aviso de novo não imprime duas vezes. Reimpressão manual cria um trabalho novo, marcado como reimpressão.
- **Estados:** aguardando, enviando, enviado, falhou e resultado desconhecido (o aparelho pegou e não respondeu em 2 minutos). Imprimir **não** muda o status do pedido nem nada financeiro.

Bibliotecas: **nenhuma nova**. Web Serial é do navegador; os comandos ESC/POS são gerados pelo próprio código (sem dependência).

## Onde fica no app

- **Painel da loja → Impressoras** (`/lojista/impressoras`): cadastrar várias impressoras (nome, setor caixa/cozinha/expedição/geral, tipo de cupom, 58 ou 80 mm, vias de 1 a 5, tabela de caracteres, impressão automática, padrão), conectar, desconectar, reconectar, imprimir teste, histórico por impressora e instruções de falhas. O dono configura; o atendente conecta e imprime.
- **Página do pedido:** "Imprimir na impressora Bluetooth", com escolha da impressora e do cupom (pedido completo, comanda da cozinha, comprovante).
- **Estação de impressão:** um aviso no canto da tela, em todas as páginas do painel, no celular onde a impressora foi conectada. Mostra o estado real e o último resultado.
- A antiga "impressão pelo navegador" (botão **Imprimir** do pedido e a opção da loja) continua para quem usa computador com impressora instalada no sistema.

## Cupons

- **Pedido completo:** loja, número do pedido em destaque, data e hora, entrega ou retirada, agendamento, cliente, telefone, endereço com bairro e referência, aviso de documento (18+), produtos com quantidades (inclusive gramas), sabores, tamanhos, adicionais, observações, subtotal, desconto, taxa de entrega, taxa de serviço, total, devolvido, forma de pagamento e troco.
- **Comanda da cozinha:** número, horário, entrega ou retirada, produtos, sabores, adicionais e observações. Sem valores, telefone ou endereço.
- **Comprovante do cliente:** como o completo, com agradecimento no fim.
- 58 mm = 32 colunas (fonte A); 80 mm = 48. Quebra de linha sem cortar palavras, valor alinhado à direita, R$ no padrão brasileiro, negrito e letra dupla. Acentos e cedilha pela tabela **CP860** (padrão), **CP850** ou **sem acentos** (para modelos que não têm nenhuma das duas). Sem imagens (impressão textual, mais confiável).

## Instalação e pareamento (no celular da loja)

1. Use um celular **Android** com o **Chrome atualizado** (versão de 2025 em diante). Abra o Chegô pelo endereço `https://...` (a Web Serial só funciona em endereço seguro).
2. Ligue a impressora. Em **Configurações → Bluetooth** do Android, pareie com ela (senha costuma ser `0000` ou `1234`).
3. No Chegô: **Painel da loja → Impressoras → Nova impressora**, dê um nome (ex.: "Impressora do Caixa"), escolha 58 mm, setor, tipo e vias.
4. Toque em **Conectar pelo Bluetooth** e escolha a impressora na lista do Android. Se o Android pedir **Dispositivos próximos**, permita. **Localização não é necessária.**
5. Toque em **Imprimir teste**.
6. Para imprimir sozinho, marque **Imprimir sozinha quando chegar pedido novo**. Só os pedidos que chegarem depois disso são impressos (nunca o histórico).

Permissões Android: o Chrome pede "Dispositivos próximos" (Android 12+) na hora de conectar. Nada de varredura Bluetooth: a lista mostra só aparelhos já pareados.

## Teste físico (pendente: feito sem impressora nesta entrega)

Os testes automáticos simulam só o hardware (uma porta serial de mentira que guarda os bytes). **Nenhuma impressora física foi testada nesta entrega**, então nenhum modelo é declarado compatível ainda. Para validar no aparelho real:

1. Pareie e conecte como acima. **Esperado:** estado "Conectada" e o nome do celular em "Neste aparelho".
2. **Imprimir teste.** Confira no papel:
   - o nome da loja e da impressora, e "Papel de 58 mm (32 colunas)";
   - a régua `1234567890...` com 32 algarismos numa linha só;
   - os acentos `á é í ó ú â ê ô ã õ à ç` e "Coração, pão, feijão, açaí, maçã.";
   - o valor alinhado à direita.
   Se os acentos saírem trocados, mude a tabela (CP860 → CP850 → sem acentos) e teste de novo.
3. Faça um pedido de teste (outro celular, como cliente) com adicionais e observação. **Esperado:** sai sozinho em até ~10 s, uma vez, com tudo o que foi pedido.
4. Recarregue o painel, feche e abra o Chrome. **Esperado:** reconecta sozinho e **não** imprime o pedido de novo.
5. Desligue a impressora e faça outro pedido. **Esperado:** a estação mostra erro e o histórico mostra "Falhou". Ligue de novo, toque em **Reconectar** e use **Reimprimir** na página do pedido.
6. Imprima a **comanda da cozinha**. **Esperado:** sem valores nem endereço.
7. Anote o modelo da impressora e a tabela que funcionou, para a lista de modelos testados.

Registre o resultado de cada passo antes de considerar a impressão física aprovada.

## Limitações conhecidas

- **Segundo plano:** o Android pausa abas que não estão na tela. A impressão automática só acontece com o Chegô **aberto e visível** no celular da impressora. Enquanto houver impressão automática ligada, o app pede para manter a tela acesa (Wake Lock). Se o celular bloquear a tela ou fechar o Chrome, os pedidos ficam na fila e saem quando o painel abrir de novo (dentro de 12 horas).
- **Confirmação:** "Enviado" significa que os bytes chegaram à impressora pelo Bluetooth. Mini impressoras não avisam se o papel acabou ou se a tampa está aberta; confira a bobina e use Reimprimir.
- **Navegadores:** só o Chrome (e derivados do Chromium) para Android tem Web Serial por Bluetooth. Firefox, Samsung Internet antigo e iPhone não têm. Nesses casos a tela explica e oferece a impressão pelo navegador.
- **Várias impressoras:** cada impressora fica ligada a um celular por vez. Um celular pode ter mais de uma conectada, mas algumas impressoras e celulares baratos aceitam uma conexão Bluetooth de cada vez.
- **Identificação da impressora no celular:** a Web Serial não informa o nome ou o endereço Bluetooth da impressora ao site. O Chegô lembra qual impressora pareada foi escolhida pela permissão que o Chrome guardou; se a permissão for removida, toque em **Conectar** de novo.
- **Corte de papel:** o comando de corte é enviado; impressoras sem guilhotina simplesmente avançam o papel.

## Publicação e atualização

- Migration `0016_thermal_printers.sql` (tabelas `store_printers` e `print_jobs`, com RLS). O contêiner aplica sozinho ao ligar (`npm run deploy:vps -- root@IP`).
- O site precisa estar em **HTTPS** (o Caddy já cuida disso).
- Nada a instalar no servidor. No celular da loja: só o Chrome atualizado.
