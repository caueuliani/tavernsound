# PR #32 — Protocolo de pré-transferência (sem ativação)

## Cenário
Hoje o banco guarda o destino planejado e a cena ativa separadamente. O Socket.IO já escopa tokens e sinais por cena, mas o gateway ainda **impede entrada em cenas fora da inicial** enquanto não houver reconexão de mapa, Agora RTC, voz, webcam e rollback de forma coordenada. Atualizar `activeSceneId` diretamente desconectaria o jogador da mesa.

## Pré-transferência da PR #32
1. Mestre prepara uma cena para o jogador em **Preparar cenário**.
2. O botão **Verificar conexão** solicita `POST /rooms/:roomId/scene/transfers/:userId/preflight`.
3. API exige mestre da sala, membro ativo, destino válido da própria sala e jogador presente na Cena inicial.
4. Gateway emite `scene-transfer-preflight` apenas para o socket autenticado daquele jogador; expira em 45 segundos e gera ID aleatório.
5. Jogador aceita ou recusa a verificação. A resposta `scene-transfer-preflight-response` só vale para o socket que recebeu o pedido, membro da mesma sala e enquanto estiver pendente.
6. Mestre consulta o resultado via `GET /rooms/:roomId/scene/transfers/preflight/:requestId`.
7. Desconexão cancela pedidos pendentes. Novos pedidos substituem pedidos anteriores do mesmo jogador.

## Garantias
- O cliente não carrega outro mapa, não troca câmera/microfone, não entra em outro canal Agora.
- Nenhuma escrita em `RoomSceneAssignment.activeSceneId`, Room, Token ou Scene.
- Confirmação significa **somente que o jogador recebeu e aceitou o pedido de verificação**, não que o teleporte foi concluído ou que a conexão multimídia está isolada.
- Pedidos temporários ficam em memória do processo. Reiniciar o servidor os cancela.
- Não habilita transferências nem remove a trava de entrada da PR #28.
- Não requer migrations.

## Próximo requisito
Implementar estado de transição efetivo com retirada das tracks Agora, snapshot da cena, confirmação de sincronização e ativação transacional, com rollback caso a conexão RTC ou canvas falhe. Exigir testes entre dois clientes e publicação coordenada antes de liberar o teleporte na UI.
