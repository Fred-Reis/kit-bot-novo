---
name: commit-msg
description: >
  Gera uma mensagem de commit baseada nas mudanças atuais do git (staged ou diff vs main).
  Use quando o usuário pedir "/commit-msg" ou quiser gerar uma mensagem de commit.
  Sempre retorna no formato: gcmsg "<mensagem>"
---

# commit-msg

## O que fazer

1. Rode `git diff --staged` para ver o que está staged. Se vazio, rode `git diff HEAD` (ou `git diff main...HEAD` para ver tudo da branch).
2. Analise as mudanças: quais arquivos, qual o propósito da alteração.
3. Gere uma mensagem de commit seguindo o padrão Conventional Commits do projeto:

```
<scope>: <ação> <objeto>
```

Exemplos de scopes: `bot`, `web`, `schema`, `types`, `foundation`, `flow`, `agent`  
Exemplos de ações: `add`, `fix`, `refactor`, `remove`, `update`

## Regras da mensagem

- Máximo 72 caracteres na primeira linha
- Em português
- Imperativo: "adicionar", "corrigir", "remover" — não "adicionado" ou "adicionando"
- Sem ponto final
- Sem emojis
- Se houver múltiplos scopes, use o mais abrangente ou o mais impactado

## Output obrigatório

Sempre gere o comando pronto para colar no terminal:

```
gcmsg "<mensagem aqui>"
```

Nada mais. Sem explicação extra, sem lista de arquivos, sem alternativas — só o comando.
