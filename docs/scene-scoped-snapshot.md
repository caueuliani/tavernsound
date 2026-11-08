# PR #27 — Snapshot isolado por cena

## Por que existe

O fluxo atual do VTT ainda usa uma única sala Socket.IO e canal Agora. O mestre já consegue preparar mapas e destinos, mas nenhum jogador deve receber o mapa, tokens ou névoa de uma cena diferente da sua **cena ativa**.

A nova leitura `GET /rooms/:roomId/scene/snapshot?sceneId=<id>` entrega um estado **somente de leitura** para futura transição controlada de cenas. Não move jogadores, não altera `activeSceneId`, não altera sockets e não abre canais Agora.

## Conteúdo retornado
- `roomId` e `sceneId`;
- definição do mapa e paredes via `publicScene`, com URL autenticada de imagem;
- `fogData` do mapa correto: campo histórico da Room na Cena inicial; campo próprio da Scene nas demais;
- tokens persistidos no banco **filtrados por `roomId` e `sceneId`**. Apenas na Cena inicial inclui tokens históricos com `sceneId IS NULL`;
- `active: false` indica explicitamente que consultar o snapshot não comanda teleporte.

## Autorização
- Mestre pode preparar e consultar qualquer cena da própria sala.
- Jogadores veem **somente a cena ativa**, nunca uma cena apenas planejada.
- Para jogador cuja cena ativa seja diferente da inicial, ler `/scene` ou `/scene/image` sem `sceneId` retorna 403; isso evita exposição via URLs legadas.
- Listagem de cenas de jogadores reflete apenas a cena ativa; editor e URLs de imagens continuam verificando a sala.

## Próxima fase (não implementada aqui)
- Associar os sockets a grupos por cena e escopar eventos de token, fog, chat e posições.
- Implementar handoff do cliente para canais Agora por cena, **incluindo webcam**, com retorno seguro em falhas.
- Criar comando do mestre que só atualize o estado ativo quando todos os canais estiverem isolados e a transição for consistente.
- Testes integrados com dois dispositivos e reconexão.

Nenhuma migration nesta PR. Não preencha manualmente `activeSceneId` antes do cutover completo.
