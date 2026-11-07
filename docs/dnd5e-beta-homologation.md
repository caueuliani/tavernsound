# TavernSound — homologação da beta D&D 5e 2014

## Pré-requisitos / bloqueios de deploy

**Apenas o CI não comprova uma mesa pronta.** Esta versão requer que os dados do
Neon sejam preservados e que as migrations abaixo sejam aplicadas **antes** de
publicar o código no Render:

- `20261107000000_campaign_game_system`
- `20261107010000_character_sheets`

1. Conferir se as URLs do Neon apontam para o banco correto. `DIRECT_URL` é a
   conexão direta para migrações; jamais publicar credenciais em GitHub ou chat.
2. Criar/verificar backup antes da mudança. Não executar `prisma migrate reset`.
3. Em ambiente seguro com as variáveis carregadas, executar `npm run db:migrate`.
4. Confirmar que `prisma migrate deploy` saiu com sucesso e as duas migrations
   constam como aplicadas antes de fazer merge da PR que usa os novos campos.
5. Se possível, testar primeiro num banco de staging/cópia; nenhum script deste
   PR provisiona banco ou habilita faturamento.

## Teste funcional D&D (duas ou mais contas)

1. Criar campanha em `/campaigns`, sistema **5E 2014 (SRD 5.1)**.
2. Gerar convite por conta do mestre; abrir o link na conta do jogador e aceitar.
3. Criar personagem em `/campaigns/<id>/characters` e preencher raça, classe,
   antecedente, nível, seis atributos, PV e CA; fechar e reabrir a ficha.
4. Confirmar modificador de DEX 14 => +2 e proficiência em nível 1 => +2.
5. Testar edição concorrente: salvar a mesma ficha com revisão antiga deve gerar
   conflito e impedir sobrescrita silenciosa.
6. Jogador que não pertence à campanha não deve listar fichas nem criar personagem.
7. Jogador de outra conta não deve editar ficha alheia; mestre pode editar.
8. Mestre deve vincular apenas **suas próprias salas**. Um usuário estranho não
   pode vincular sala nem campanha de outro.
9. Abrir a sala vinculada e clicar **Fichas D&D**; a ficha deve abrir numa nova
   guia sem desconectar o áudio da mesa.
10. Rolar d20 normal, vantagem e desvantagem. Verificar que o histórico indica
    corretamente os dois dados usados e que o servidor calculou o resultado.

## Teste de mesa online

- Mestre e participantes entram por contas distintas em navegadores reais.
- Confirmar voz bidirecional, fones, mute/deafen e distância em mapa aberto.
- Comparar voz através de parede e porta aberta/fechada.
- Recarregar página do jogador e reiniciar a API em horário controlado para
  confirmar retorno de tokens, posição, chat, mapa e permissões.
- Usar outro navegador no celular para validar gesto de ativação do áudio.
- Conferir desempenho, tempo de resposta e uso de recursos na hospedagem.

**Cotas importantes:** modo beta mantém os padrões de 5 participantes e 60
participante-minutos globais/dia até que variáveis explícitas sejam definidas.
Seis microfones ligados por três horas consomem aproximadamente 1080
participante-minutos, sujeitos ainda aos limites/custos do Agora. Conferir a
franquia antes de aumentar as cotas.

## Critério de aceitação

Não anunciar a campanha como 100% funcional enquanto houver falha na
reconexão, perda de estado, áudio unilateral ou migrações não aplicadas.
A interface básica de ficha não inclui ainda automação completa de magias,
combate, talentos, subclasses e compêndios.
