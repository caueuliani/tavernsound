# PR #34 — Carregador de snapshot da cena no cliente

## O que entrega
- A mesa pode buscar `GET /rooms/:roomId/scene/snapshot?sceneId=<id>` usando exclusivamente o identificador de cena informado pelo servidor no evento autenticado `room-joined`.
- `readSceneSnapshot` valida sala, cena, estrutura do mapa, névoa e a associação de **cada token** à cena solicitada. Conteúdo inconsistente é rejeitado sem aplicação.
- O carregamento usa `AbortController` para cancelar respostas atrasadas ao trocar a cena ou sair da mesa.
- Em modo opt-in `NEXT_PUBLIC_SCENE_RTC_HANDOFF=true`, o mapa e a névoa são alimentados pelo snapshot; `mapData` legado é limpo.
- Na falta de névoa válida, todas as células ficam cobertas, em vez de reutilizar revelações de outra cena.
- O fluxo legado de carregamento por `GET /scene` continua sendo o padrão, sem mudanças para as mesas atuais.

## Restrições intencionais
- Esta PR **não ativa outras cenas** no Neon e não habilita o botão de teleporte.
- A flag é **desligada por padrão**; não ligue no beta público antes de atualizar todos os participantes e validar o protocolo de ativação.
- Apesar de o snapshot incluir tokens, a tela não os substitui ainda: identidade, posse e movimentação continuam gerenciadas pelo Socket.IO. O corte de tokens entre cenas virá junto da entrada na cena alternativa.
- O gateway ainda recusa participantes com `activeSceneId` fora da Cena inicial. Assim, ninguém passa a ver mapa alternativo de forma involuntária.
- Testes no CI cobrem identificação de sala/cena, vazamento de tokens, névoa inválida e resposta incompleta.

## Próximos passos
1. Implementar entrada em grupo Socket.IO alternativo com snapshot de tokens, posse e geometria corretos.
2. Coordenar `activeSceneId` com troca de canal Agora e reconexão; usar o rollback da PR #33 em falhas.
3. Expor a ativação real ao mestre após testes de privacidade em dois navegadores.
4. Homologar áudio, webcam, rede interrompida, reconexão e retorno à Cena inicial.

Nenhuma nova migration nesta PR.
