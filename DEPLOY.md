# Publicação contínua no Netlify

## Preparar o banco

Para um projeto Supabase novo, execute `supabase/schema.sql` no SQL Editor. Para um banco existente que ainda não tenha ordenação, execute `supabase/migrations/20261008_001_ordering.sql`. Os deploys do frontend não aplicam scripts de banco automaticamente.

## Conectar o GitHub e publicar

1. Entre em https://app.netlify.com e selecione a equipe desejada.
2. Clique em **Add new project → Import an existing project → GitHub**.
3. Autorize a integração e permita acesso ao repositório da organização **lucassverissimo-org/checklist-pro**. Se ele não aparecer, ajuste o acesso da instalação do Netlify em **GitHub → Settings → Applications → Installed GitHub Apps → Netlify → Configure**; se solicitado, um administrador da organização precisa aprovar a instalação.
4. Escolha o repositório e defina **Production branch: main**.
5. Deixe o diretório base vazio, **Build command: npm run build** e **Publish directory: dist**. O `netlify.toml` já fornece build, saída, Node 22, redirecionamento de SPA e cabeçalhos.
6. Antes do primeiro deploy, adicione as variáveis de ambiente abaixo. Elas precisam estar disponíveis durante o build em produção. Se a tela de importação não permitir incluí-las, configure em **Project configuration → Environment variables** e dispare um novo deploy em **Deploys** depois de salvar.

| Variável                   | Valor                                              |
| -------------------------- | -------------------------------------------------- |
| `VITE_SUPABASE_URL`        | Project URL do seu projeto Supabase                |
| `VITE_SUPABASE_PUBLIC_KEY` | Chave pública publishable ou anon do mesmo projeto |

Nunca use `service_role` ou chave secreta: variáveis `VITE_` são incorporadas ao código público do navegador. Sem valores válidos, o aplicativo oferece apenas demonstração local. Não copie `.env.local` para o GitHub.

7. Clique em **Deploy**. Em **Project configuration → Build & deploy → Continuous deployment**, confira que o repositório está conectado, a branch de produção é `main` e os builds estão ativos.
8. Abra a URL publicada, crie um checklist e abra o link de edição em outro navegador. Confira a sincronização dos dois navegadores e a persistência após recarregar.

Não é necessário criar um GitHub Actions para publicar. A integração nativa do Netlify recebe os pushes e faz o deploy. Ao trocar variáveis de ambiente, faça um novo deploy para reconstruir o frontend.

## Publicar alterações futuras

```powershell
cd C:\projetos_lucas\checklist-pro
npm test
npm run build
git add .
git commit -m "Descreva a alteração"
git push origin main
```

Cada push com novos commits na `main` dispara um deploy de produção. Commits apenas locais não disparam deploy. Se o build falhar, consulte o log em **Deploys**; o site continua na última versão publicada com sucesso.

Quando uma alteração exigir banco, gere a migração incremental e atualize `schema.sql`. Aplique a migração no Supabase antes de publicar o frontend que depende dela.

Referências: [importar um projeto](https://docs.netlify.com/manage/projects/add-new-project/), [deploy pelo repositório](https://docs.netlify.com/start/quickstarts/deploy-from-repository/) e [variáveis de ambiente](https://docs.netlify.com/build/environment-variables/get-started/).
