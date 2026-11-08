# PR #36 — Comando de ativação em transação (interno, default-off)

## Preparação
Primeiro protocolo capaz de **gravar** uma cena alternativa de forma controlada, ainda sem habilitar o botão de teleporte. A ativação fica **totalmente desabilitada por padrão**: requer simultaneamente `SCENE_LIVE_TRANSFERS=true` e `SCENE_SCOPED_ADMISSION=true` no backend e um socket do jogador com `sceneTransportV2=true` (frontend com `NEXT_PUBLIC_SCENE_RTC_HANDOFF=true`).

**Não habilite essas variáveis na produção ou na mesa pública até o cliente implementar a troca após `scene-activation-required`, com áudio, webcam, mapa, token e ACK de conclusão.**

## Rota interna
`POST /rooms/:roomId/scene/transfers/:userId/activate` com `{ "requestId": "<UUID-do-preflight>" }`.

- Exige mestre da sala, jogador membro ativo, atribuição de cena preparada ainda válida, cena inicial ativa, destino da própria sala e preflight **aceito, não expirado e pertencente ao mesmo socket conectado V2**.
- Dentro de uma única transação Prisma, executa compare-and-set da atribuição `activeSceneId` e migra o token do personagem (`sha256(roomId:userId)`) da Cena inicial à cena de destino, preservando HP, imagem e posição. Sem token persistido, ainda assim muda a cena ativa.
- Conflito ou falha de persistência aborta a transação inteira. Um pedido concorrente não consegue substituir o destino de outra confirmação.
- Depois de commit, o servidor consome o preflight e avisa apenas o socket do jogador via `scene-activation-required`. Esse evento **não é prova de mudança de mapa nem de mídia**. O handoff real do cliente será adicionado nas próximas PRs.
- Não há botão para chamar este endpoint no cliente atual.

## Recuperação aprimorada
O retorno do mestre à Cena inicial (#33) agora restaura **na mesma transação** tanto `activeSceneId = NULL` quanto `Token.sceneId = initial-<roomId>`; evita deixar o personagem invisível depois do rollback administrativo.

## Limites de segurança
- Sem ACK de canal Agora, nem compromisso distribuído entre banco e sockets. Ainda não é uma transferência pronta para usuário.
- Tokens Agora já emitidos não são revogados imediatamente.
- Após commit e antes do reload do cliente, o socket antigo ainda pode permanecer no grupo inicial. Portanto essa rota continua **indisponível por configuração** até o cliente ser implementado e testado.
- Uma implantação com múltiplas instâncias Nest exige coordenação de sessões e de eventos além de mapas em memória. A versão atual foi estruturada para a instância de beta.
- A geometria e a posição do token após a troca devem ser verificadas no novo mapa; a PR #35 mantém movimentação de tokens alternativos bloqueada.
- Ainda faltam testes reais de dois dispositivos, perda de rede, mudança de cena com webcam ativa e retorno seguro.

Nenhuma migration nova, usa `activeSceneId` da PR #26.
