import { describe, expect, it } from 'bun:test';
import { classifyDocument } from '@/services/doc-classifier';

const CNH_FRONT = `CARTEIRA NACIONAL DE HABILITAÇÃO
NOME FREDERICO LOPES
DOC. IDENTIDADE 12345678 SSP GO
CPF 123.456.789-00 DATA NASCIMENTO 01/01/1990
FILIAÇÃO MARIA LOPES
CAT. HAB. B  Nº REGISTRO 01234567890  VALIDADE 10/10/2030`;

const CNH_BACK = `OBSERVAÇÕES
LOCAL
GOIÂNIA, GO
DATA EMISSÃO 10/10/2020
ASSINATURA DO EMISSOR`;

const CNH_FULL = `${CNH_FRONT}\n${CNH_BACK}`;

const RG_BACK = `REGISTRO GERAL 12.345.678-9 DATA DE EXPEDIÇÃO 05/05/2015
NOME FREDERICO LOPES
FILIAÇÃO MARIA LOPES / JOSÉ LOPES
NATURALIDADE GOIÂNIA GO
CPF 123.456.789-00`;

const RG_FRONT = `REPÚBLICA FEDERATIVA DO BRASIL
SECRETARIA DE SEGURANÇA PÚBLICA
CARTEIRA DE IDENTIDADE`;

const CPF_CARD = `MINISTÉRIO DA FAZENDA
CADASTRO DE PESSOAS FÍSICAS
NÚMERO DE INSCRIÇÃO 123.456.789-00
NOME FREDERICO LOPES`;

const HOLERITE = `DEMONSTRATIVO DE PAGAMENTO
EMPRESA X LTDA  CNPJ 00.000.000/0001-00
FUNCIONÁRIO FREDERICO LOPES CPF 123.456.789-00
SALÁRIO BASE 12.000,00  TOTAL LÍQUIDO 10.500,00`;

describe('classifyDocument', () => {
  it('CNH frente', () => expect(classifyDocument(CNH_FRONT)).toBe('cnh_front'));
  it('CNH verso', () => expect(classifyDocument(CNH_BACK)).toBe('cnh_back'));
  it('CNH aberta em foto única', () => expect(classifyDocument(CNH_FULL)).toBe('cnh_full'));
  it('RG verso (lado dos dados)', () => expect(classifyDocument(RG_BACK)).toBe('rg_back'));
  it('RG frente', () => expect(classifyDocument(RG_FRONT)).toBe('rg_front'));
  it('CPF', () => expect(classifyDocument(CPF_CARD)).toBe('cpf'));
  it('comprovante de renda antes de CPF (holerite tem CPF no texto)', () =>
    expect(classifyDocument(HOLERITE)).toBe('income_proof'));
  it('texto vazio → unknown', () => expect(classifyDocument('')).toBe('unknown'));
  it('foto aleatória → unknown', () => expect(classifyDocument('gato deitado no sofá')).toBe('unknown'));
});
