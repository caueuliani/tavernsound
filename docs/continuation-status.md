# Estado para retomada — 26/09/2026

## Retomada da correção de áudio — 04/10/2026

Validados 19 testes de gateway e integração, incluindo entrada tardia, identidade de voz autenticada e isolamento entre salas. Correção de sincronização e botão de retomada de reprodução preparados para teste LAN. A confirmação auditiva notebook → celular continua pendente de teste real do usuário; não considerar essa etapa validada apenas pela compilação.

## Áudio em dois aparelhos — 03/10/2026

Usuário confirmou login e microfone nos dois aparelhos, voz celular → notebook e atenuação por distância funcionando. Sentido notebook → celular estava silencioso. Encontrada ausência de sincronização das identidades Agora dos participantes anteriores no hook: agora o servidor reenvia identidades da mesma sala quando recebe o anúncio autenticado do novo participante. Teste de regressão cobre entrada tardia e isolamento entre salas (9 testes de gateway passaram). Interface acompanha o estado do AudioContext e oferece “Ativar som neste aparelho” quando a reprodução estiver suspensa; toque/clique/teclado também tentam retomá-la. Confirmação auditiva nos dois sentidos e paredes/portas ainda dependem do reteste nos aparelhos do usuário. Automação permanece pausada.

## Correção de inicialização e login — 03/10/2026

Corrigida integração das campanhas já presentes no workspace: SessionAuthGuard usa SessionService existente; imports de DTOs são de tipo; histórico carrega membros para autorizar acesso. Migração aditiva 20261003000000_campaigns aplicada no banco local, sem reset. Inicializador gera Prisma Client antes de compilar. Atualizações de campanha/sessão só encaminham os campos editáveis, sem permitir troca de proprietário via payload.

Login agora tem prazo de 20 segundos, confirmação de sessão salva e navegação completa após autenticação. Chamadas internas de login e consulta de sessão também têm timeout. 19 testes direcionados passaram; builds API/Next concluídos. Servidor HTTPS reiniciado em https://192.168.0.3:8443. O usuário informou ter ignorado aviso de certificado no celular; instalar confiança ainda é necessário para o teste correto. Login nesse celular ainda depende de reteste pelo usuário. Automação continua pausada por pedido do usuário.

## Entregue localmente

Home pública em `/`, com apresentação, três mapas SVG alternáveis e três retratos SVG originais de personagens. Salas movidas para `/rooms`, ainda protegidas pelo proxy de autenticação. CTAs levam ao login com retorno para `/rooms`; login direto também usa esse destino. Build concluído e navegador verificou acesso público, troca dos três cenários, carregamento das imagens, destino do CTA e ausência de overflow horizontal em largura móvel. Prévia salva em `../outputs/tavernsound-home.png`. Sem alteração de hospedagem.

Editor de cenários com upload, escala, deslocamento, grade, paredes, portas, contornos de cavernas, desfazer/refazer e persistência. Exemplos SVG: Taverna, Masmorra e Caverna. Guia: `scene-editor.md`.

Validação registrada nesta conversa: 82 testes de API passaram; depois da remoção dos eventos antigos de edição, os 16 testes direcionados de gateway/cenário passaram novamente. Builds de API e web concluídos. No navegador foram verificados upload do exemplo Taverna, criação de parede e porta, abertura da porta, persistência após recarregar, escala e desfazer/refazer, além de criação e desfazer de contornos.

## Pendências de validação

Exclusão de salas implementada na página inicial, disponível apenas ao dono e com confirmação nativa do navegador antes do DELETE. O servidor valida a propriedade, remove registros relacionados por cascata, encerra conexões e limpa o mapa local. Os 20 testes direcionados de salas, acesso e gateway passaram. Nenhuma campanha real foi excluída para testar. A conferência visual autenticada desse botão ainda depende do login do usuário.

- Completar a verificação visual do arraste de segmentos e dos exemplos Masmorra/Caverna. O navegador voltou à tela de login; aguardar sessão autenticada do usuário, sem solicitar senha no chat.
- Testar áudio espacial com dois participantes reais, incluindo porta aberta/fechada. Não está validado ponta a ponta; depende dos participantes e da janela permitida de áudio.
- Antes de publicação com mapas, definir armazenamento persistente. Upload local está habilitado apenas pelo inicializador local; não habilitar faturamento automaticamente.

Preparação da sala de teste: http://localhost:8080/room/L4U1XW/scene. Essa página não inicia áudio.

Não refazer testes já aprovados sem mudança ou falha que justifique. Não descartar alterações locais, redefinir cotas ou criar novas tarefas automaticamente quando as solicitações autorizadas estiverem concluídas. A retomada horária deste chat deve respeitar os bloqueios acima e as orientações mais recentes do usuário.

## HTTPS e retratos — atualização de 26/09

HTTPS local validado com a CA gerada (TLS autorizado, sem ignorar certificados); /rooms redireciona para https://192.168.0.3:8443/login?callbackUrl=%2Frooms. Inicializador: node work/start-tavernsound.mjs --lan --skip-build. Usar a mesma URL HTTPS no notebook e celular. Certificado público: ../outputs/TavernSound-Teste-Local.cer. Guia: ../outputs/Testar-TavernSound-na-Rede.md. Confiança de certificado e firewall não alterados automaticamente.

Retratos por personagem/sala implementados via HTTP autenticado: imagem estática até 2 MB, WebP 256×256 salvo no banco; apenas a conta dona pode alterar. 14 testes direcionados e 3 testes de proxy passaram, API e Next compilados.

Aguardando respostas já solicitadas: sistema do celular e segundo e-mail autorizado. Instalação do certificado e teste real com dois participantes dependem do usuário. Não repetir perguntas nas retomadas. Publicação ainda depende de banco remoto e armazenamento persistente de mapas; nenhum serviço contratado ou faturamento habilitado.
