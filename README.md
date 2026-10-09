# Checklist Pro

Checklist colaborativo por link, sem cadastro. Projeto independente do Checklist OBMEP: não utiliza os arquivos, o armazenamento ou a publicação daquele aplicativo.

## Rodar agora

```powershell
cd C:\projetos_lucas\checklist-pro
npm install
npm run dev
```

Sem configuração, a aplicação oferece uma **demonstração local**. É possível criar, editar, marcar atividades, adicionar comentários e duplicar checklists. O banner identifica esse modo, e o compartilhamento está desabilitado. As demonstrações ficam no `localStorage` deste navegador; não são colaboração online.

## Ativar colaboração com Supabase

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

As chaves públicas apenas habilitam chamadas à API; **o token do link é validado no banco em todas as leituras e alterações**. O usuário não precisa criar conta. Não há servidor Node ou Edge Function para publicar: as operações são funções PostgreSQL chamadas pela API REST do Supabase.

## Publicar no Netlify

Para publicação automática a cada push na `main`, siga o passo a passo em [DEPLOY.md](DEPLOY.md).

Execute `npm run build` com `.env.local` configurado. Publique **a pasta `dist` deste projeto em um novo site**, preservando o site da OBMEP. No upload manual, as variáveis precisam estar configuradas antes do build. Se usar integração Git, cadastre as duas variáveis no Netlify; `netlify.toml` já define o build e a pasta de publicação.

## Inclusão rápida e organização

Digite no campo **Adicionar etapa…** e pressione **Enter**, ou use o botão de adicionar. O botão **Nova etapa** leva diretamente a esse campo. Ao salvar uma etapa, o foco vai para o campo da primeira atividade. Dentro de cada etapa, digite em **Adicionar atividade…** e pressione **Enter**. O campo é limpo após salvar e mantém o foco para você continuar digitando atividades sem abrir janelas.

Use a alça de pontos para arrastar etapas e atividades. Atividades podem ser soltas em outra etapa, inclusive vazia ou recolhida; a etapa de destino abre após o movimento. A marcação e o comentário acompanham a atividade. No celular, arraste pela alça; o restante da página continua disponível para rolagem normal. Por teclado, foque a alça, pressione **Espaço**, use as setas e pressione **Espaço** novamente para soltar; **Escape** cancela.

Com pesquisa ou **Apenas pendentes** ativos, a ordenação fica desabilitada para evitar mover itens para posições ocultas. Limpe os filtros para arrastar novamente.

## Atualizar um banco Supabase existente

Para esta versão, execute [supabase/migrations/20261008_001_ordering.sql](supabase/migrations/20261008_001_ordering.sql) no SQL Editor. O script substitui apenas a função de alterações, dentro de uma transação, e preserva os dados e links existentes. Não é preciso recriar tabelas.

Para uma instalação nova, execute somente `supabase/schema.sql`, que já inclui as operações de ordenação. Nas próximas alterações, os scripts incrementais serão adicionados à pasta `supabase/migrations` e o schema completo será mantido atualizado.

## Como os links funcionam

- **Link de edição:** qualquer pessoa que o possuir pode visualizar e editar atividades, etapas e comentários. Ele pode ser repassado. Não existe identificação verificada dos participantes.
- **Link de administração:** permite editar, renovar o link de edição ou excluir o checklist inteiro. É entregue ao criador. Guarde-o separadamente e não o envie à equipe.
- Os códigos possuem 256 bits aleatórios e são enviados na parte depois de `#` do endereço. O banco armazena apenas os hashes dos tokens, não os links completos.
- Checklists recentes e as chaves do criador são lembrados neste navegador. Sem login, perder o link e limpar o navegador elimina a forma de recuperar o acesso.
- Ao abrir o link de administração em outro navegador, a chave de edição anterior não pode ser recuperada. Gere uma nova em Compartilhar; o link antigo será revogado.
- Renove o link se precisar encerrar acessos anteriores. Quem tem o link antigo perde acesso nas próximas operações/atualizações; isso não apaga cópias de dados já vistas por essa pessoa.
- Um link remoto aponta para o mesmo checklist; não é uma cópia do conteúdo. **Duplicar checklist** cria uma cópia independente com novas chaves.

## Edição concorrente e conexão

O aplicativo consulta alterações a cada **três segundos**, apenas enquanto está visível, e também ao recuperar foco ou conexão. Esta primeira versão usa atualização periódica, não WebSocket. Cada participante vê o status de conexão e salvamento.

O banco bloqueia a linha durante cada operação, e compara o valor anterior apenas do campo alterado. Duas pessoas podem editar atividades diferentes, ou editar o texto e marcar a mesma atividade, sem sobrescrever o trabalho uma da outra. Se ambas editarem o mesmo campo, a segunda alteração é rejeitada; a interface mantém o rascunho, mostra a versão atual e permite revisá-la. Excluir uma etapa ou atividade também exige que ela não tenha mudado desde a confirmação.

Ao ordenar, o banco compara os IDs e a ordem das listas envolvidas com a posição no início do arraste. Se outra pessoa adicionar, remover ou mover itens nessas listas durante o movimento, a operação é rejeitada e a interface pede para tentar novamente. Edições de texto, comentário e marcação não impedem o movimento e são preservadas.

Sem conexão, os dados já carregados continuam visíveis, mas alterações não são enfileiradas para envio futuro. Textos de edição ficam na janela aberta para tentar novamente. Uma resposta perdida pode exigir conferir se a operação foi aplicada antes de repetir; a lista é atualizada ao reconectar. Não há persistência de rascunhos após fechar ou atualizar a página.

## Arquitetura

- React 18, TypeScript e Vite; CSS responsivo e Lucide para ícones.
- `src/model.ts`: tipos, links, limites e regras da demonstração.
- `src/api.ts`: API REST protegida por tokens, demonstração e recentes.
- `src/useChecklist.ts`: carregamento, salvamento e atualização automática.
- `src/App.tsx`: criação, lista de recentes e edição do checklist.
- `src/components.tsx`: diálogos acessíveis com foco nativo, edição com conflito e compartilhamento por QR Code.
- `src/ChecklistSections.tsx`: etapas e atividades ordenáveis com mouse, toque e teclado.
- `src/QuickAdd.tsx`: inclusão direta e contínua por Enter.
- `supabase/schema.sql`: tabela privada, validação e funções com controle de acesso. Sem acesso direto às tabelas pelos papéis públicos.

Limites: 100 etapas, 500 atividades por etapa, 2.000 atividades no total, 120 caracteres para nomes, 2.000 para atividades, 10.000 por comentário e aproximadamente 256 KB por checklist. A função de criação é pública; antes de abrir o produto para uso amplo, acrescente proteção contra criação automatizada e acompanhe quotas/custos do serviço. O modelo atual é voltado a pequenos grupos, sem histórico de versões ou edição simultânea de texto caractere por caractere.

## Verificações

```powershell
npm test
npm run build
```

Os testes executam o SQL real em PostgreSQL embarcado (PGlite), incluindo acesso, concorrência e administração. Não substituem a conferência da configuração de um projeto Supabase real. Os testes de interface estão em `tests/ui.spec.ts` e podem ser executados com `npx playwright test` após instalar o Chromium de testes (`npx playwright install chromium`).

Referências: [funções PostgreSQL no Supabase](https://supabase.com/docs/guides/database/functions), [API RPC](https://supabase.com/docs/reference/javascript/rpc) e [controle de acesso](https://supabase.com/docs/guides/database/postgres/row-level-security).
