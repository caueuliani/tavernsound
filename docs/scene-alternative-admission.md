# PR #35 — Entrada autorizada em cenas alternativas (opt-in, somente leitura)

## Objetivo
Permitir ao backend preparar a admissão de um jogador cuja cena **ativa** já esteja fora da Cena inicial, sem reutilizar tokens, névoa ou geometria da sala antiga. **Esta PR não oferece um comando para ativar cenas**.

## Travamentos obrigatórios
1. O servidor só aceita entrada alternativa quando `SCENE_SCOPED_ADMISSION=true`. Sem a variável, ou com qualquer outro valor, continua recusando.
2. O cliente deve declarar `sceneTransportV2: true` no `join-room`, emitido apenas nos builds onde `NEXT_PUBLIC_SCENE_RTC_HANDOFF=true`. Cliente legado é recusado mesmo que o backend esteja preparado.
3. A cena é derivada por `activeSceneForUser` no servidor; `sceneId` vindo do cliente não decide a cena.
4. A Scene precisa existir na própria sala. Falha de leitura = recusa da entrada.
5. A mídia só usa o canal Agora da cena ativa com o token emitido pelo backend. Ainda não existe ACK da mídia nem rollback automatizado, então `scene-transport-ready.isolated=false` continua correto.
6. O servidor **não altera** `RoomSceneAssignment.activeSceneId` em nenhuma operação desta PR. Mantenha ambas as flags DESLIGADAS em produção.

## Estado da entrada alternativa
- Busca tokens exclusivamente de `Token.roomId + Token.sceneId`, com posições finas persistidas, sem misturar o cache da Cena inicial.
- Mapa/parede e névoa exclusivamente da `Scene` autorizada; não usa Room.mapUrl/fogOfWarData.
- O cliente opt-in já possui carregamento do mapa via `/scene/snapshot` (#34).
- Ambientação inicial é `off`; histórico de rolagens legadas é **omitido**, porque não está associado a cenas no banco.
- Histórico de chat é filtrado por metadados de cena; mensagens sem sceneId pertencem à Cena inicial.
- Rolagens em cenas alternativas ficam **desabilitadas** até que a persistência de resultados tenha vínculo com cena: do contrário, o histórico global da Cena inicial revelaria seus resultados.
- Lista de participantes só inclui pessoas na mesma cena; eventos e UIDs de voz continuam restritos ao grupo de cena.
- Presença, chat e áudio podem operar apenas dentro da cena autorizada. Criação, movimentação e HP dos tokens em cenas alternativas permanecem **somente leitura** até termos migração de posse, geometria e rollback; não são executados com o modelo da Cena inicial.

## Ainda falta antes de homologação real
- Criar/ativar destino por comando autenticado do mestre com state machine, validação de ACK de mapa, Socket.IO e mídia (áudio e webcam).
- Transferir/revincular os tokens dos jogadores à nova cena com controle transacional e restabelecer a movimentação.
- Garantir desfazer em falhas de rede, troca de conexão, duas abas e tokens Agora previamente emitidos.
- Testar dois navegadores e dois dispositivos, com áudio e webcam, **depois** das demais etapas.

Nenhuma migration necessária.
