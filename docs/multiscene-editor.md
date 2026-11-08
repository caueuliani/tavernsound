# Editor de múltiplas cenas — etapa 2

Após a migração aditiva da PR #21, o mestre pode usar **Preparar cenário** para criar e editar até 20 cenas, com mapa PNG/JPG/WebP (até 3 MB), grade, paredes e portas. Novas cenas permanecem **rascunhos**: não substituem o mapa exibido pela mesa até a futura implementação de ativação/atribuição de jogadores.

- O editor usa `?sceneId=<id>` para acessar somente uma cena da própria sala.
- Sem `sceneId` os endpoints antigos continuam lendo e salvando `Room.sceneData` e `Room.mapUrl`, mantendo o jogo atual compatível.
- A `Cena inicial` delega à implementação legada para evitar duas cópias divergentes do mapa ativo.
- As demais cenas salvam `Scene.sceneData` e `Scene.mapUrl` em PostgreSQL, separadas do mapa ativo.
- A API valida que a cena pertence à sala, que o usuário é membro para visualizá-la e que somente o mestre pode editá-la; jogadores só podem consultar a cena atribuída.
- Revisão e `updatedAt` detectam conflitos de edição concorrente.
- Nenhuma migração adicional ou alteração em WebRTC/Agora é necessária.

## Homologação recomendada

1. Mestre abre `/room/<id>/scene`, cria `Praia` e `Masmorra`, importa mapas e salva.
2. Alterna entre os rascunhos e confirma que seus ajustes são independentes.
3. Abre a mesa `/room/<id>` em outra aba: o mapa ativo continua igual.
4. Reabre o editor e confirma persistência dos rascunhos.
5. Jogador não pode salvar, renomear nem consultar cena não atribuída por URL direta.
6. Testar conflito de revisão em duas abas e mapa inválido.

## Próxima etapa

Com essa base testada no Render, habilitar cenas ativas, transferência de personagens e isolamento de voz por cena. **Não ativar mudança de cenas sem isolar áudio e tokens.**
