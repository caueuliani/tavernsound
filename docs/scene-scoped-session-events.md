# PR #30 — eventos de sessão isolados por cena

Esta etapa completa a separação incremental dos **eventos de presença e comunicação Socket.IO**. O servidor escolhe o grupo por `sceneId` associado ao jogador autenticado, sem aceitar uma cena arbitrária no payload do navegador.

## Eventos migrados
- `player-joined`, `player-left`, atualização de posição espacial e de configurações de áudio
- mute, deafen, indicador de fala e anúncio/replay de UID Agora
- `chat-message-received` e `dice-rolled`
- `ambient-preset-updated`
- a lista `players` no `room-joined` filtra somente participantes da mesma cena
- mensagens de CHAT novas persistem `sceneId` no JSON de metadados; o histórico na entrada ignora conversas de outras cenas. CHAT antigo sem `sceneId` é tratado como pertencente à Cena inicial.

## Eventos deliberadamente globais
- Encerramento/exclusão de sala, erros administrativos e `room-player-count` (contagem agregada de usuários), não contendo mapa, chat, token ou mídia.
- A mesa ainda armazena um `ambientPreset` e configurações de voz globais para a Cena inicial; os eventos estão separados, mas persistência independente por cena requer nova etapa.

## Restrições de segurança
- A conexão de mídia Agora (áudio **e webcam**) ainda usa o canal legada compartilhado.
- **O gateway continua recusando qualquer jogador com `activeSceneId` fora da Cena inicial.** Nenhuma transferência real foi habilitada.
- Novas credenciais de mídia já seguem a autorização de cena ativa, mas credenciais anteriores expiram naturalmente: ainda falta coordenar `leave`, fechar tracks, entrar no canal novo e tratar falhas.
- Rolagens antigas permanecem em histórico por sala na Cena inicial; histórico por cena exigirá modelo/persistência adicional se for habilitada a transferência.

## Testes de homologação futura
1. Dois jogadores na Cena inicial preservam voz, webcam, chat, mute, dados e tokens.
2. Um cliente não consegue receber identidade Agora/sinais de fala de outro grupo de cena.
3. Chat histórico só exibe registros com `sceneId` da cena ativa, preservando os legados na Cena inicial.
4. Cenários diferentes ainda são bloqueados pelo gateway legado até o handoff da mídia.

Nenhuma migration nesta PR.
