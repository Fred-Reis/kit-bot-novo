import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import { config } from '@/config';

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

function renderPdf(body: string, code: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 72, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(11).text(`CONTRATO DE LOCAÇÃO — ${code}`, { align: 'center' });
    doc.moveDown();
    doc.font('Helvetica').fontSize(10).text(body, { align: 'justify', lineGap: 4 });
    doc.end();
  });
}

export async function generateAndUploadPdf(
  contractId: string,
  body: string,
  code: string,
): Promise<string> {
  const buffer = await renderPdf(body, code);
  const path = `${contractId}.pdf`;

  const { error } = await supabase.storage.from('contracts').upload(path, buffer, {
    contentType: 'application/pdf',
    upsert: true,
  });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  return path;
}
