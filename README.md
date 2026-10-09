# Checklist Pro

Checklist colaborativo por link, sem cadastro. Projeto independente do Checklist OBMEP: não utiliza os arquivos, o armazenamento ou a publicação daquele aplicativo.

## Rodar agora

```powershell
cd C:\projetos_lucas\checklist-pro
npm install
npm run dev
```

Sem configuração, a aplicação oferece uma **demonstração local**. É possível criar, editar, marcar itens, adicionar comentários e duplicar checklists. O banner identifica esse modo, e o compartilhamento está desabilitado. As demonstrações ficam no `localStorage` deste navegador; não são colaboração online.

## Ativar colaboração com Supabase

**Configuração da versão atual:** consulte [SUPABASE.md](SUPABASE.md) para banco, anexos privados, Edge Function e limpeza automática.

1. Crie um projeto separado em [Supabase](https://supabase.com/dashboard).
2. Abra o **SQL Editor** e execute todo o arquivo [supabase/schema.sql](supabase/schema.sql). As funções `pro_create`, `pro_read`, `pro_apply` e `pro_manage` devem aparecer no esquema `public`.
3. Nas configurações do projeto, copie a **Project URL** e a **chave pública publishable ou anon**. Nunca use `service_role` ou uma chave secreta no frontend.
4. Copie `.env.example` para `.env.local` e preencha:

```dotenv
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_PUBLIC_KEY=SUA-CHAVE-PUBLICA
```

5. Reinicie `npm run dev`. O banner de demonstração desaparecerá; novos checklists serão salvos no banco. Os checklists de demonstração anteriores continuam locais.
6. Crie um checklist e use **Compartilhar → Link de edição**. Abra-o em outro navegador. Faça uma alteração e confira que ela aparece no primeiro em até três segundos. Para outro dispositivo, use um endereço publicado ou um endereço acessível na rede, não `localhost`.

As chaves públicas apenas habilitam chamadas à API; **o token do link é validado no banco em todas as leituras e alterações**. O usuário não precisa criar conta. As operações do checklist são funções PostgreSQL chamadas pela API REST; os arquivos passam pela Edge Function `checklist-files`.

## Publicar no Netlify

Para publicação automática a cada push na `main`, siga o passo a passo em [DEPLOY.md](DEPLOY.md).

Execute `npm run build` com `.env.local` configurado. Publique **a pasta `dist` deste projeto em um novo site**, preservando o site da OBMEP. No upload manual, as variáveis precisam estar configuradas antes do build. Se usar integração Git, cadastre as duas variáveis no Netlify; `netlify.toml` já define o build e a pasta de publicação.

## Inclusão rápida e organização

Os termos da interface são **seção** e **item**. A lixeira exclui imediatamente o item ou a seção com todos os seus itens, sem confirmação. O banco ainda protege contra alterações concorrentes.

O lápis abre a edição na própria página: título do checklist no topo, nome da seção junto ao cabeçalho e texto do item abaixo da linha. Salvar aplica a alteração; Cancelar ou Escape descarta o rascunho. Enter salva nomes; nos textos de itens e comentários, Enter insere uma nova linha. Rascunhos são mantidos em falhas e conflitos.

O botão **Detalhes do item** abre um painel com comentário, prioridade e anexos. Comentário e prioridade usam Salvar/Cancelar. Arquivos são salvos ao enviar. Uma bandeira perto da alça sinaliza prioridade baixa, média ou alta, com texto acessível e marca além da cor. Sem prioridade, o ícone fica oculto. Um indicador no botão de detalhes mostra comentário ou anexo. O filtro de prioridade preserva a ordem escolhida. Escape fecha o painel quando nenhum arquivo está sendo enviado.

Ao colar uma lista separada por linhas ou ponto e vírgula, o sistema oferece uma prévia editável e a opção **Adicionar N itens** ou **Manter como um item**. Marcadores e numeração comuns são removidos. Até 100 itens podem ser criados juntos em uma operação atômica, sem separar automaticamente frases por vírgulas ou pontos.

A lixeira exclui imediatamente e mostra **Desfazer** por 30 segundos. Restaurar traz o item ou seção, incluindo comentários, prioridade e anexos, sem desfazer alterações em outros itens. Se a seção de destino foi removida ou o limite do checklist foi atingido, a restauração é recusada. A exclusão do checklist inteiro é definitiva.

Digite no campo **Adicionar seção…** e pressione **Enter**, ou use o botão de adicionar. O botão **Nova seção** leva diretamente a esse campo. Ao salvar uma seção, o foco vai para o campo do primeiro item. Dentro de cada seção, digite em **Adicionar item…** e pressione **Enter**. O campo é limpo após salvar e mantém o foco para você continuar digitando itens sem abrir janelas.

Use a alça de pontos para arrastar seções e itens. Itens podem ser soltos em outra seção, inclusive vazia ou recolhida; a seção de destino abre após o movimento. A marcação e o comentário acompanham o item. No celular, arraste pela alça; o restante da página continua disponível para rolagem normal. Por teclado, foque a alça, pressione **Espaço**, use as setas e pressione **Espaço** novamente para soltar; **Escape** cancela.

Com pesquisa ou **Apenas pendentes** ativos, a ordenação fica desabilitada para evitar mover itens para posições ocultas. Limpe os filtros para arrastar novamente.

## Atualizar um banco Supabase existente

Para esta versão, execute [supabase/migrations/20261009_002_item_details.sql](supabase/migrations/20261009_002_item_details.sql) no SQL Editor e siga [SUPABASE.md](SUPABASE.md). A migração já inclui ordenação e preserva os dados e links existentes. Não execute a migração antiga de ordenação depois desta versão.

Para uma instalação nova, execute somente `supabase/schema.sql`, que já inclui as operações de ordenação. Nas próximas alterações, os scripts incrementais serão adicionados à pasta `supabase/migrations` e o schema completo será mantido atualizado.

## Como os links funcionam

- **Link de edição:** qualquer pessoa que o possuir pode visualizar e editar itens, seções e comentários. Ele pode ser repassado. Não existe identificação verificada dos participantes.
- **Link de administração:** permite editar, renovar o link de edição ou excluir o checklist inteiro. É entregue ao criador. Guarde-o separadamente e não o envie à equipe.
- Os códigos possuem 256 bits aleatórios e são enviados na parte depois de `#` do endereço. O banco armazena apenas os hashes dos tokens, não os links completos.
- Checklists recentes e as chaves do criador são lembrados neste navegador. Sem login, perder o link e limpar o navegador elimina a forma de recuperar o acesso.
- Ao abrir o link de administração em outro navegador, a chave de edição anterior não pode ser recuperada. Gere uma nova em Compartilhar; o link antigo será revogado.
- Renove o link se precisar encerrar acessos anteriores. Quem tem o link antigo perde acesso nas próximas operações/atualizações; isso não apaga cópias de dados já vistas por essa pessoa.
- Um link remoto aponta para o mesmo checklist; não é uma cópia do conteúdo. **Duplicar checklist** cria uma cópia independente com novas chaves.

## Edição concorrente e conexão

O aplicativo consulta alterações a cada **três segundos**, apenas enquanto está visível, e também ao recuperar foco ou conexão. Esta primeira versão usa atualização periódica, não WebSocket. Cada participante vê o status de conexão e salvamento.

O banco bloqueia a linha durante cada operação, e compara o valor anterior apenas do campo alterado. Duas pessoas podem editar itens diferentes, ou editar o texto e marcar o mesmo item, sem sobrescrever o trabalho uma da outra. Se ambas editarem o mesmo campo, a segunda alteração é rejeitada; a interface mantém o rascunho, mostra a versão atual e permite revisá-la. Excluir uma seção ou item também exige que ela não tenha mudado entre o clique e o processamento da exclusão.

Ao ordenar, o banco compara os IDs e a ordem das listas envolvidas com a posição no início do arraste. Se outra pessoa adicionar, remover ou mover itens nessas listas durante o movimento, a operação é rejeitada e a interface pede para tentar novamente. Edições de texto, comentário e marcação não impedem o movimento e são preservadas.

Sem conexão, os dados já carregados continuam visíveis, mas alterações não são enfileiradas para envio futuro. Textos de edição ficam na janela aberta para tentar novamente. Uma resposta perdida pode exigir conferir se a operação foi aplicada antes de repetir; a lista é atualizada ao reconectar. Não há persistência de rascunhos após fechar ou atualizar a página.

## Arquitetura

- React 18, TypeScript e Vite; CSS responsivo e Lucide para ícones.
- `src/model.ts`: tipos, links, limites e regras da demonstração.
- `src/api.ts`: API REST protegida por tokens, demonstração e recentes.
- `src/useChecklist.ts`: carregamento, salvamento e atualização automática.
- `src/App.tsx`: criação, lista de recentes e edição do checklist.
- `src/components.tsx`: diálogos de administração e compartilhamento por QR Code.
- `src/ChecklistSections.tsx`: seções e itens ordenáveis com mouse, toque e teclado.
- `src/InlineActions.tsx`: edição e comentários na página, com proteção contra conflitos, e exclusão direta.
- `src/QuickAdd.tsx`: inclusão direta e contínua por Enter.
- `src/ItemDetails.tsx`: comentário, prioridade e anexos, sem modal.
- `src/attachments.ts`: upload com progresso, download e arquivos locais em IndexedDB.
- `src/lists.ts`: detecção de listas coladas, sem enviar textos a uma IA.
- `supabase/functions/checklist-files`: acesso aos arquivos e limpeza com autorização no servidor.
- `supabase/schema.sql`: tabela privada, validação e funções com controle de acesso. Sem acesso direto às tabelas pelos papéis públicos.

Limites: 100 seções, 500 itens por seção, 2.000 itens no total, 120 caracteres para nomes, 2.000 para itens, 10.000 por comentário e aproximadamente 256 KB por checklist. A função de criação é pública; antes de abrir o produto para uso amplo, acrescente proteção contra criação automatizada e acompanhe quotas/custos do serviço. O modelo atual é voltado a pequenos grupos, sem histórico de versões ou edição simultânea de texto caractere por caractere.

## Verificações

```powershell
npm test
npm run build
```

Os testes executam o SQL real em PostgreSQL embarcado (PGlite), incluindo acesso, concorrência e administração. Não substituem a conferência da configuração de um projeto Supabase real. Os testes de interface estão em `tests/ui.spec.ts` e podem ser executados com `npx playwright test` após instalar o Chromium de testes (`npx playwright install chromium`).

Referências: [funções PostgreSQL no Supabase](https://supabase.com/docs/guides/database/functions), [API RPC](https://supabase.com/docs/reference/javascript/rpc) e [controle de acesso](https://supabase.com/docs/guides/database/postgres/row-level-security).
