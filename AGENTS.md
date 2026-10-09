# Checklist Pro

Este é um projeto separado do Checklist OBMEP. Trabalhe apenas neste diretório para alterações no Checklist Pro.

## Alterações no Supabase

Por solicitação do usuário, qualquer alteração necessária no banco deve incluir:

1. Um script incremental em `supabase/migrations`, com nome ordenável por data e sequência, para executar no banco existente.
2. A mesma definição atualizada em `supabase/schema.sql`, usado para criar o banco de produção do zero.

Os scripts devem preservar os checklists, as chaves de acesso e as permissões existentes. Não recrie nem apague tabelas para fazer atualizações rotineiras. Verifique que o script incremental e o schema completo produzem as mesmas funções.

Gere e entregue os scripts; não aplique alterações em serviços externos sem autorização para essa aplicação.
