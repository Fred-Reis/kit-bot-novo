# docs/domain.md — Domínio do negócio

## Jornada oficial do lead

1. interesse
2. visita
3. envio de documentação para análise
4. contrato
5. pagamento
6. entrega das chaves

## O que o bot pode responder antes da visita

- valor do aluguel e caução
- condições de parcelamento da caução
- prazo e condições do contrato
- exigências e restrições do imóvel
- localização
- fotos, anúncio e vídeo
- o lead é quem define se ja visitou ou não o imóvel

## O que o bot NÃO pode fazer antes da visita

- pedir renda
- pedir documentos
- iniciar etapa de análise documental

## Documentos aceitos para análise

- **CNH** (frente e verso)
- ou **RG + CPF:**
  - primeiro: RG frente e verso
  - depois: CPF

## Dados da KIT-01 (seed inicial)

Estes dados devem estar no banco. O bot nunca lê daqui diretamente — sempre via `catalog.ts`.

```
ID:                   KIT-01
Nome:                 Kitnet no Retiro
Endereço:             Rua Laranjeiras, 111 — Retiro
Aluguel:              R$ 900
Quartos:              1
Banheiros:            1
Inclusos:             água e IPTU
Por conta do inquilino: luz (individual)
Primeira locação:     sim
Entrada independente: não
Animais:              não aceita
Máx. moradores:       2 adultos
Crianças/bebês:       não aceitos
Caução:               R$ 900 (parcelável em até 3x)
Primeiros 3 meses:    R$ 1.200 cada
Contrato inicial:     6 meses
Proprietário:         Fred (locação direta)
Visitas:              segunda a sexta, 9h–17h
                      sábado com confirmação (ideal até meio-dia)
                      procurar Valéria ou Vitória
Anúncio OLX:          https://rj.olx.com.br/serra-angra-dos-reis-e-regiao/imoveis/alugo-kitnet-no-retiro-1487572817
```

Mídia da KIT-01 deve ser cadastrada no Supabase Storage e a URL registrada no banco.

## Fluxo de tenant — fase 2

Três trilhas após identificação pelo banco:

**Financeiro**
- Dúvidas sobre RGI, contrato, histórico de pagamentos

**Manutenção**
- Classifica responsabilidade: inquilino ou proprietário
- Classifica tipo: elétrica, hidráulica, civil, limpeza/conservação
- Retorna dicas/links ou indica profissional cadastrado
- Abre chat com proprietário se necessário

**Informações/Reclamações**
- Registra tudo no banco no perfil do usuário
- Encaminha cópia para o proprietário
