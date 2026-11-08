# PR #29 — eventos de tokens isolados por cena

Esta etapa converte a transmissão dos eventos de estado dos tokens para grupos Socket.IO `scene:<id derivado no servidor>`, substituindo os broadcasts para a sala inteira. O cliente entra apenas no grupo da Cena inicial enquanto a transferência real não estiver habilitada.

## Eventos de token migrados
- Criação, movimento, remoção e HP de token.
- Nome, tamanho e retrato/imagem de token.
- Remoção e recriação da presença visual do token durante reconexão.
- Atualizações do cenário ativo da Room enviadas apenas ao grupo da Cena inicial.

Um evento de token usa o `sceneId` do token no estado autorizado do servidor; tokens legados sem vínculo usam a Cena inicial. Tokens ausentes não geram broadcast. Nenhuma propriedade `sceneId` enviada pelo navegador é usada como autorização.

## Ainda compartilhados pela sala (não seguro para split)
- Áudio e webcam Agora, reconhecimento de participantes, sinais de fala.
- Chat, rolagens e som ambiente, além de outros eventos remanescentes.
- Neblina e demais atualizações legadas que exigem auditoria de eventos e endpoints.

**Não habilite o teleporte ainda.** PR #28 continua rejeitando entrada de jogadores cuja cena ativa não seja a inicial; esse bloqueio protege contra os canais ainda globais.

Não há migration nem mudanças no Neon nesta PR. O comportamento da Cena inicial deve permanecer compatível com a mesa atual.
