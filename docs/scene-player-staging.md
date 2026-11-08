# Etapa 3 — preparação de destinos por jogador

Esta entrega **não ativa a troca de cenas na mesa**. O mestre pode preparar a cena de destino dos membros ativos sem alterar o mapa, névoa, tokens, voz ou webcam do jogo atual.

## Mestre
- Abra **Preparar cenário** na sala.
- Escolha o destino planejado de cada jogador na seção **Destinos dos personagens**.
- O destino persiste em `RoomSceneAssignment` no Neon, com FK para a cena.
- A API aceita apenas membros ativos da sala e cenas que realmente pertencem à sala. Usuários não-mestres não conseguem consultar ou modificar as atribuições.
- Não cria migrations novas; depende do schema da PR #21 já aplicado.

## Segurança antes da ativação
- Um destino planejado **não autoriza visualizar o rascunho**.
- Jogadores continuam recebendo somente a Cena inicial pela API de cenas; acesso direto à imagem e aos metadados de uma cena ainda não ativada permanece bloqueado.
- Não há emissão Socket.IO para mudança de cena nem alteração dos tokens/áudio.
- Quando ativarmos cenas em sessão real, precisaremos mover os sockets para salas de cena, filtrar eventos/tokens, atualizar o mapa/fog em cada cliente e, principalmente, isolar **a mídia Agora** (áudio e webcam) por cena antes de qualquer atribuição ao vivo.
- O host poderá monitorar os destinos planejados sem revelar informações de outro cenário antecipadamente.

## Homologação
1. Criar Praia e Taverna como rascunhos no editor.
2. Como mestre, escolher Praia como destino de um membro ativo.
3. Atualizar a página: o destino permanece persistido.
4. Como jogador, não conseguir consultar os rascunhos por `sceneId` nem suas imagens.
5. Na mesa, confirmar que todos permanecem no mapa inicial com áudio, webcam e sons ambientes sem alteração.
