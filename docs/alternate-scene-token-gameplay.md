# Gameplay de tokens nas cenas alternativas

## Escopo
- Gateway mantém cache de tokens/paredes/grade por `roomId:sceneId`, separado da `Room` inicial.
- Jogador transferido pode **criar seu token próprio** (se inexistente), movimentá-lo e alterar seu HP na cena ativa. O servidor valida a posse, o cenário ativo persistido, posição e colisão com paredes.
- Gravações de movimento/HP alternativas usam `token.updateMany` com `roomId + sceneId + id` e só divulgam eventos após sucesso. Erros não alteram cache nem vazam dados da Cena inicial.
- Mestre pode criar, reposicionar, editar HP ou excluir **NPCs da cena alternativa** no editor Preparar cenário. Endpoints autenticados exigem mestre, cena da própria sala e tipo `SCENERY`, inclusive em remoção e atualização.
- Evento dos NPCs é dirigido exclusivamente ao grupo Socket.IO da cena. Se ninguém estiver presente, o estado continua salvo no banco.
- Sem migration.

## Limitações e segurança
- O mestre continua na Cena inicial por desenho; gerencia os NPCs da cena alternativa no painel, não clicando diretamente nos tokens daquele mapa.
- As ferramentas de edição do painel usam coordenadas de grade; a validação no backend impede mover através de paredes e sair dos limites.
- A mudança de cena continua protegida pelas três flags de homologação do multiscene, todas desligadas por padrão.
- Tokens próprios dos jogadores continuam únicos por conta/sala. NPCs possuem UUID individual.
- Cenários alternativos **não** recebem eventos de outras cenas.
- Historico persistido de rolagens ainda é por sala e continua bloqueado em cenas alternativas; não está no escopo desta PR.

## Verificação
No ambiente de homologação, com jogador A na Cena B:
1. Criar token próprio caso ainda não exista; não deve aparecer na Cena inicial.
2. Arrastar token numa célula válida; atualizar página e conferir persistência.
3. Tentar atravessar parede ou movimentar token de outro usuário; rejeição sem broadcast.
4. Editar HP do próprio token e atualizar a página; deve persistir.
5. No painel do mestre, selecionar Cena B e criar NPC com coordenadas; conferir evento em tempo real na Cena B.
6. Mover NPC pelo painel, editar HP e excluir; conferir após recarregar.
7. Confirmar que a Cena inicial nunca recebeu tokens, movimentos ou HP da Cena B.
8. Retornar à Cena inicial pelo mestre; token pessoal acompanha a atribuição, NPCs continuam na Cena B.

A homologação de Agora (áudio e webcam), reconexão e rollback permanece obrigatória antes de liberar para usuários.
