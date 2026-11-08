# PR #28 — Socket.IO com admissão por cena (preparação)

## Situação atual

O TavernSound ainda utiliza eventos Socket.IO da sala inteira para tokens, névoa, chat, posições e identidade Agora. O canal RTC de áudio e webcam continua compartilhado. **Não ativamos teleporte**; qualquer cliente com cena ativa fora da inicial é impedido de ingressar no protocolo legado até a migração completa.

## Novidades

- `sceneSocketRoom(roomId, sceneId)` deriva um grupo Socket.IO interno, único por sala/cena.
- Ao fazer `join-room`, o servidor consulta `activeSceneForUser`, **não** a cena preparada pelo mestre.
- Usuários cuja cena ativa não é a inicial recebem erro e **não são admitidos** na sala insegura; a partida tradicional permanece na Cena inicial.
- A conexão admitida participa do grupo interno da cena inicial e recebe `scene-transport-ready: { sceneId, isolated: false }`. O campo `isolated: false` deixa claro que a conexão ainda compartilha o protocolo legado.
- O snapshot `room-joined` inclui `sceneId` e restaura somente tokens da Cena inicial, incluindo legados sem `sceneId`. Tokens de outras cenas não entram no estado em memória desse gateway.
- Não há comando de ativação, alteração em `activeSceneId`, nova migration, nem movimento de jogadores.

## Testes

- Rejeição de entrada em cena não inicial antes de qualquer restauração ou adesão ao canal legado.
- Agrupamento de socket derivado no servidor, sem `sceneId` fornecido pelo cliente.
- Restauração sem vazar tokens de outra cena.
- Regressão da entrada normal na Cena inicial.

## Próxima etapa

Escopar **todos** os eventos de tokens, fog, NPCs e voz por cena e migrar o canal Agora de áudio **e webcam** com descarte de tracks antigos. Somente depois implementar um handoff com ack, rollback e ativação transacional. Caso contrário, jogadores de cenas distintas poderiam continuar recebendo dados ou mídia de outras cenas.
