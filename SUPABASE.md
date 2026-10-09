# Ativar detalhes de itens, anexos e desfazer

Prepare o Supabase antes de publicar esta versão. O projeto OBMEP não é afetado.

## 1. Atualizar o banco

No projeto do Checklist Pro, abra **SQL Editor** e execute o arquivo inteiro `supabase/migrations/20261009_002_item_details.sql`.

Ele é cumulativo: já inclui a definição atual de ordenação. Se ainda não aplicou a migração de 08/10, não precisa executá-la antes desta. Não execute a migração antiga depois desta versão.

Para um banco novo, execute somente `supabase/schema.sql`, que contém todas as definições atuais.

O script adiciona os registros privados de arquivos e exclusões temporárias e atualiza as funções. Preserva documentos, links e permissões. Itens antigos funcionam como “Sem prioridade”. A restauração fica disponível por 30 segundos após excluir um item ou seção; excluir o checklist inteiro continua definitivo.

## 2. Criar o armazenamento privado

1. Abra **Storage → New bucket**.
2. Nome: **`checklist-attachments`**.
3. Deixe **Public bucket desativado**.
4. Limite de arquivo: **10 MB** (10.485.760 bytes).
5. Tipos permitidos: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `application/pdf`.
6. Não crie políticas públicas de leitura ou escrita. A função abaixo acessa o Storage após validar o link do checklist.

Os limites adicionais são 5 anexos por item e 100 MB por checklist. Os arquivos são separados do JSON do checklist. Downloads usam URLs válidas por 60 segundos. Revogar um link impede novos acessos, mas uma URL de download já emitida pode funcionar até expirar.

## 3. Publicar a Edge Function

No PowerShell:

```powershell
cd C:\projetos_lucas\checklist-pro
npx supabase login
npx supabase functions deploy checklist-files --project-ref SEU_PROJECT_REF --no-verify-jwt --use-api
```

Troque `SEU_PROJECT_REF` pelo identificador do projeto mostrado no Dashboard/URL do Supabase. O código está em `supabase/functions/checklist-files`. A configuração `supabase/config.toml` também desativa a checagem de JWT de usuário: não usamos login. A função valida nosso token de checklist no banco antes de enviar, baixar ou remover arquivos.

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são variáveis fornecidas pelo ambiente hospedado das Edge Functions. A chave secreta nunca deve ir para o Netlify, para uma variável `VITE_` ou para o navegador.

## 4. Configurar a limpeza automática

Novos acessos a arquivos removidos são negados imediatamente; URLs temporárias já emitidas podem durar até 60 segundos. A limpeza apaga os objetos físicos depois do período de restauração e uploads interrompidos com mais de uma hora. Sem essa rotina, arquivos removidos continuam ocupando espaço.

1. Gere um segredo aleatório no PowerShell:

```powershell
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
```

2. Em **Edge Functions → Secrets**, cadastre `CHECKLIST_CLEANUP_SECRET` com esse valor. Guarde-o para o próximo passo; não coloque o valor no código.
3. Em **Vault**, crie três segredos:

| Nome                        | Valor                                       |
| --------------------------- | ------------------------------------------- |
| `checklist_project_url`     | A URL `https://SEU_PROJECT_REF.supabase.co` |
| `checklist_publishable_key` | Sua chave pública publishable/anon          |
| `checklist_cleanup_secret`  | O mesmo valor de `CHECKLIST_CLEANUP_SECRET` |

4. Ative **Cron / pg_cron** e **pg_net** pelo Dashboard (Integrations/Database Extensions).
5. Execute `supabase/setup-cleanup.sql` no SQL Editor. Ele cria/atualiza uma rotina a cada 10 minutos, processando até 100 arquivos por execução.
6. Confira em **Cron → Jobs** e os resultados HTTP em `net._http_response`. Sucesso deve retornar HTTP 200 com a quantidade removida. Falhas são tentadas na próxima execução.

## 5. Publicar e conferir

As variáveis do frontend continuam `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLIC_KEY`. Não há variável nova no Netlify. Faça um novo deploy após configurar banco, bucket e função.

Confira em dois navegadores:

- Cole uma lista com linhas ou `;`, ajuste a prévia e clique em “Adicionar N itens”.
- Abra “Detalhes do item”, salve comentário e prioridade e confira a bandeira no outro navegador.
- Envie uma imagem/PDF e baixe pelo outro navegador.
- Exclua o item e clique em “Desfazer” em até 30 segundos; comentário, prioridade e anexos devem voltar.
- Mova o item para outra seção; seus anexos devem acompanhá-lo.
- Remova um anexo e aguarde a limpeza para conferir que ele saiu do Storage.

Na demonstração local, arquivos ficam no IndexedDB do navegador e não são compartilhados. Duplicar um checklist copia textos, comentários e prioridades, sem copiar anexos.

Os testes locais executam SQL real em PGlite e o handler de arquivos com uma API de Storage simulada. A publicação e a integração com seu Supabase real precisam ser conferidas após os passos acima.

Referências: [configuração de Edge Functions](https://supabase.com/docs/guides/functions/function-configuration), [buckets privados](https://supabase.com/docs/guides/storage/buckets/fundamentals) e [agendamento com Cron e Vault](https://supabase.com/docs/guides/functions/schedule-functions).
