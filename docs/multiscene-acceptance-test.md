# Homologação única — TavernSound multiscene (PRs #21–#37)

> **Status:** funcionalidade experimental. CI verde não substitui teste de privacidade de áudio/webcam com pessoas e dispositivos distintos. Execute fora de uma mesa real; **não habilite em produção pública** até concluir todos os critérios.

## Pré-condições

1. `main` atualizada até a PR #37; o CI do último commit precisa estar verde.
2. Backend executando **uma instância API** com `SCENE_SCOPED_ADMISSION=true` e `SCENE_LIVE_TRANSFERS=true`. Ambas são necessárias para permitir ativação. Sem elas, a UI/rota deve bloquear o cutover.
3. Frontend recompilado com `NEXT_PUBLIC_SCENE_RTC_HANDOFF=true`, idealmente em ambiente de homologação separado. **É uma variável de build do Next.js, não basta alterá-la depois do build.** Use a mesma versão para todos os navegadores.
4. Duas contas distintas, uma como **mestre** e uma como **jogador**, com sessões em perfis de navegador/dispositivos diferentes. Para checar comunicação **entre jogadores** em cenas distintas, use uma terceira conta (jogador B). Nunca use duas abas com o mesmo login como substituto de contas diferentes.
5. Configure uma sala temporária com Cena inicial e Cena B (ambas com mapas facilmente distinguíveis). Coloque um token/NPC identificável e névoa diferente em cada cena. Prepare um destino para o jogador A.
6. Microfone e webcam permitidos para cada conta. Dispositivos distintos são melhores para testar a ausência real de áudio vazado. Se usar o mesmo ambiente físico, fones de ouvido evitam confundir som direto com vazamento RTC.
7. Prepare acesso do mestre a **Restaurar Cena inicial**. Não altere `activeSceneId` por SQL ou Prisma. Evite executar a homologação durante uma partida.

## Execução — uma única sessão de teste

| Etapa | Ação | Critério para aprovar |
|---|---|---|
| 1. Controle inicial | Mestre, A e B entram na Cena inicial (ambos os jogadores no modo V2). Testar chat, tokens, microfone, webcam, mute/deafen. | Todos veem somente dados da inicial; os dois jogadores se escutam e veem as câmeras quando autorizadas. |
| 2. Preparação | Mestre seleciona Cena B apenas para A no painel Preparar cenário. | Nenhum mapa, áudio ou token muda por atribuir o destino. B permanece na inicial. |
| 3. Pré-transferência | Mestre clica **Verificar conexão** para A; A confirma; mestre clica **Consultar confirmação** antes de expirar (45 s). | Status `accepted`; ativação **ainda não ocorreu**. B não recebe popup. |
| 4. Ativação | Mestre clica **Ativar transferência (experimental)** para A, ainda dentro da validade do preflight. | A recarrega automaticamente e recebe Cena B, seus tokens, névoa e mapa. A webcam antiga fecha; para voltar a transmitir câmera é preciso acionar o botão. |
| 5. Privacidade do mapa | A olha a Cena B; B olha a inicial. Fazer chat e sinais de voz; observar NPCs de cada cena. | A não vê nem recebe tokens/névoa/mapa da inicial; B não vê dados da Cena B. Mensagens e eventos de presença não atravessam cenas. |
| 6. Privacidade RTC | Com A na Cena B e B na inicial, testar fala contínua, mute/deafen e webcam dos dois. | A e B **não** recebem áudio ou vídeo um do outro. Conferir em ambos os sentidos, incluindo ativar webcam após transferência. |
| 7. Reconexão | Atualizar a aba de A já na Cena B; testar fechar/reabrir aba. | A volta somente à Cena B autorizada; não cai no canal legado. A webcam permanece desligada até nova ação. |
| 8. Retorno administrativo | Mestre abre Preparar cenário e clica **Restaurar Cena inicial** para A. | A recebe aviso/é desconectado e ao recarregar volta à Cena inicial com seu token; B continua sem interrupção. |
| 9. Falha de rede | Repetir ativação de A, mas desligar internet/fechar aba antes do ACK. | Em até 90 s após ativação, **se a instância API continuar viva**, ocorre rollback automático de `activeSceneId` e `Token.sceneId`. Recuperação manual deve continuar possível. |
| 10. Aba extra | A conecta duas abas da mesma conta (cenário controlado), ativa a transferência a partir do mestre. | A aba antiga não deve continuar em sessão RTC da Cena inicial; atualizar a aba deve carregar a cena autorizada. |
| 11. Modo legado | Em ambiente separado, desligar as flags e testar o VTT padrão. | A mesa de uma cena continua funcional; cliente legado não é admitido em cena alternativa. |

## Reprovação imediata / parar testes

- **Qualquer áudio ou webcam atravessando cenas:** desligue `SCENE_LIVE_TRANSFERS` e `SCENE_SCOPED_ADMISSION` no backend de homologação, mantenha usuários fora da sessão, use a recuperação administrativa para restaurar `activeSceneId`, e investigue logs e permissões Agora. Desligar flags **não revoga imediatamente tokens RTC emitidos**.
- **A vê mapa, NPCs, chat ou névoa de outra cena:** interrompa a homologação e não coloque a funcionalidade em produção.
- **ACK sem mapa carregado ou áudio conectado:** revisar o estado do cliente e o protocolo, não marcar como aprovado.
- **Falha de rollback:** use Restaurar Cena inicial no painel; verifique se token persistente também voltou à Cena inicial. Se o servidor reiniciou, o temporizador em memória não sobreviverá — a recuperação administrativa é obrigatória.
- **Versões diferentes de frontend/backend ou múltiplas instâncias API:** não aprovar. O handoff pendente e o timeout são locais à instância atual.

## Registro objetivo dos resultados

Anote para cada etapa **PASSOU / FALHOU / NÃO TESTADO**, navegador/dispositivo, horário aproximado e erro/screenshot relevante. Não compartilhe cookies, tokens Agora, credenciais de ambiente ou dados pessoais.

Se qualquer teste de privacidade falhar, a condição final permanece **NÃO APROVADO**. A confirmação do socket é um sinal do próprio cliente, **não uma auditoria independente da mídia no Agora**.

## Limitações conhecidas mesmo se todos os testes passarem

- Cena alternativa continua de leitura para tokens: sem criar, arrastar ou editar HP; rolagens em cena alternativa ficam bloqueadas enquanto não houver persistência por cena.
- Persistência de handoff/timeout em vários servidores ainda exige coordenação distribuída.
- O corte da aplicação não invalida imediatamente credenciais RTC antigas já emitidas.
- Retorno à Cena inicial é recuperação administrativa, não uma transferência bidirecional contínua já homologada.

## Critério de liberação

**Somente** considerar disponibilização controlada após todas as etapas acima aprovadas e confirmação de que os riscos residuais são aceitáveis. Enquanto isso, deixar as flags de ativação desabilitadas no ambiente público e usar a mesa tradicional.
