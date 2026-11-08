# Cena planejada vs. cena ativa — fase de segurança

A PR #23 criou `RoomSceneAssignment.sceneId` como **destino planejado** pelo mestre. Não é uma transferência ao vivo. Nesta etapa adicionamos a coluna opcional `activeSceneId` para que a autorização da mídia dependa de um estado diferente.

## Nova migration
`20261108010000_active_scene_assignment/migration.sql`
- Adiciona `activeSceneId TEXT NULL` em `RoomSceneAssignment`.
- Índice e FK para `Scene`; sem atualizar linhas existentes.
- `NULL` significa que o participante continua na Cena inicial.
- A aplicação ainda **não possui botão ou evento que altere `activeSceneId`**. É deliberado: o corte de áudio e o transporte de mapa precisam acontecer juntos.
- Backup de Neon antes de aplicar; se rodar SQL no Neon, registrar via Prisma `migrate resolve --applied` após verificar o resultado.

## Autorização segura
- `/agora/token?channelName=<roomId>&sceneId=<sceneId>` emite token apenas para a cena ativa da conta, nunca apenas pelo destino planejado.
- O token legado `/agora/token?channelName=<roomId>` continua válido quando a cena ativa é a inicial, para manter a mesa atual.
- Caso uma cena não inicial seja ativada futuramente, a API **não emite novos tokens legados** para aquele jogador.
- **Atenção:** tokens Agora já emitidos permanecem válidos até expirar ou até o cliente sair do canal; por isso uma mudança futura precisa fechar o cliente RTC antigo e não depender só desse bloqueio.
- O mestre continua no canal da Cena inicial nesta fase; monitoramento entre cenas exigirá um modelo de autorização separado.

## Antes do teleporte real
1. Criar transição de ativação no backend com controle de concorrência, sem expor rascunhos.
2. Implementar uma sequência de preparação/ack do RTC que saia do canal antigo e conecte ao novo, incluindo webcam.
3. Escopar tokens, posições, névoa e eventos Socket.IO por cena; revisar também endpoints HTTP.
4. Testes entre dois dispositivos, incluindo reconexão, expiração e falha durante o corte.
5. Só então disponibilizar o botão de teleporte para o mestre.

Não habilite manualmente `activeSceneId` no banco; o fluxo completo de cutover ainda não existe.
