# PR #33 — Recuperação operacional de uma transferência de cena

## Motivo
O protocolo Socket.IO legado não permite entrada de jogadores cuja `activeSceneId` não seja a Cena inicial. Uma ativação de cena sem handoff de mapa, áudio e webcam poderia impedir reconexões. Esta PR fornece um procedimento de **recuperação**, obrigatório antes de expor a ativação real.

## Rota de recuperação GM
`POST /rooms/:roomId/scene/transfers/:userId/return-to-initial`

- Exige sessão autenticada, mestre da sala, jogador **membro ativo**; nunca permite restaurar outro mestre.
- Atualiza apenas `RoomSceneAssignment.activeSceneId` para `NULL` (significa Cena inicial). Usa `updateMany` condicionado a valor não nulo para tornar a operação idempotente.
- Não altera `sceneId` do destino planejado, nem os mapas ou tokens; o mestre pode preparar nova tentativa depois.
- Cancela preflights pendentes para aquele membro e encerra sockets antigos do mesmo usuário **apenas naquela sala**. Uma nova entrada restaura a Cena inicial; a UI avisa que o jogador precisa atualizar a página.
- `GET /scene/assignments` passa a expor `activeSceneId` ao mestre, permitindo identificar participantes fora da inicial.
- O painel mostra o botão **Restaurar Cena inicial** somente para jogadores com cena ativa diferente da inicial.

## Segurança e limitações
- **Nenhum botão de ativação/teleporte foi criado** e esta PR não atualiza nenhum `activeSceneId` para um destino alternativo.
- Este rollback é uma correção administrativa de estado, **não** um rollback distribuído atômico de Socket.IO + Agora + canvas.
- Um token Agora antigo pode continuar válido até expirar; a recuperação não garante sua revogação imediata no serviço.
- Em vários processos API, a atualização persistida alcança o Neon, mas o encerramento de sockets em outros processos exigiria um adaptador/coordenação distribuída.
- Para ativação de cena jogável ainda é obrigatório: preparo de mídia, bloqueio de áudio e webcam antigos, troca autorizada do grupo Socket.IO, substituição atômica do snapshot do mapa e verificação de reconexão em outro dispositivo.

## Migration
Nenhuma — a coluna `activeSceneId` foi criada na PR #26.
