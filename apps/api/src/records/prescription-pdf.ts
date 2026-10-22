import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { DateTime } from 'luxon';
import type { PrescriptionItem, RecordsService } from './records.service';

type Data = NonNullable<Awaited<ReturnType<RecordsService['prescriptionData']>>>;

const SEX: Record<string, string> = { F: 'Femenino', M: 'Masculino', X: 'Otro' };

function age(birthDate: Date | null, at: Date): string | null {
  if (!birthDate) return null;
  const years = Math.floor(DateTime.fromJSDate(at).diff(DateTime.fromJSDate(birthDate), 'years').years);
  if (years >= 2) return `${years} años`;
  const months = Math.floor(DateTime.fromJSDate(at).diff(DateTime.fromJSDate(birthDate), 'months').months);
  return `${months} meses`;
}

/** Receta en PDF (carta): datos de la clínica y del médico con su cédula, paciente, medicamentos y código de verificación. */
export async function prescriptionPdf(d: Data, verifyUrl: string): Promise<Buffer> {
  const { prescription: p, doctor, clinic, location } = d;
  const doc = new PDFDocument({ size: 'LETTER', margin: 50, info: { Title: `Receta ${p.code}`, Author: doctor.displayName } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const tz = clinic.timezone;
  const issued = DateTime.fromJSDate(p.issuedAt, { zone: tz }).setLocale('es');
  const width = doc.page.width - 100;
  const gray = '#555555';

  // Encabezado: clínica y folio.
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#000').text(clinic.name, 50, 50, { width: width - 170 });
  const address = location?.address ?? clinic.address;
  const contact = [address, location?.phone ?? clinic.phone].filter(Boolean).join(' · ');
  if (contact) doc.font('Helvetica').fontSize(9).fillColor(gray).text(contact, { width: width - 170 });
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#000').text('RECETA MÉDICA', 50 + width - 160, 50, { width: 160, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(gray)
    .text(`Folio: ${p.code}`, { width: 160, align: 'right' })
    .text(issued.toFormat("d 'de' LLLL 'de' yyyy, HH:mm 'h'"), { width: 160, align: 'right' });

  // Médico.
  doc.moveTo(50, 112).lineTo(50 + width, 112).strokeColor('#cccccc').stroke();
  doc.y = 120;
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(doctor.displayName, 50);
  const school = doctor.education[0];
  doc.font('Helvetica').fontSize(9).fillColor(gray).text([
    doctor.specialty,
    doctor.licenseNumber ? `Cédula profesional ${doctor.licenseNumber}` : 'Cédula profesional: (registrar en el perfil del médico)',
    school ?? null,
  ].filter(Boolean).join(' · '));

  // Paciente.
  doc.moveDown(0.8);
  const patientLine = [
    `Paciente: ${d.patientName}`,
    age(d.birthDate, p.issuedAt) ? `Edad: ${age(d.birthDate, p.issuedAt)}` : null,
    d.sex ? `Sexo: ${SEX[d.sex] ?? d.sex}` : null,
  ].filter(Boolean).join('    ');
  doc.font('Helvetica').fontSize(10).fillColor('#000').text(patientLine);
  const v = d.vitals ?? {};
  const vitals = [
    v.weightKg ? `Peso ${v.weightKg} kg` : null, v.heightCm ? `Talla ${v.heightCm} cm` : null,
    v.systolic && v.diastolic ? `TA ${v.systolic}/${v.diastolic} mmHg` : null, v.temperature ? `Temp. ${v.temperature} °C` : null,
  ].filter(Boolean);
  if (vitals.length) doc.fontSize(9).fillColor(gray).text(vitals.join('    '));
  const allergies = d.allergies.map((a) => a.substance);
  doc.fontSize(9).fillColor(allergies.length ? '#b00020' : gray).text(`Alergias: ${allergies.length ? allergies.join(', ') : 'negadas'}`);
  if (p.diagnosis) doc.fillColor('#000').text(`Diagnóstico: ${p.diagnosis}`);

  // Medicamentos.
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#000').text('Rx', 50);
  doc.moveDown(0.3);
  (p.items as unknown as PrescriptionItem[]).forEach((item, i) => {
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(`${i + 1}. ${item.drug}${item.presentation ? ` · ${item.presentation}` : ''}`, 60, doc.y, { width: width - 10 });
    const how = [item.dose, item.route ? `vía ${item.route}` : null, item.frequency, item.duration ? `durante ${item.duration}` : null].filter(Boolean).join(', ');
    doc.font('Helvetica').fontSize(10).text(how ? `${how.charAt(0).toUpperCase()}${how.slice(1)}.` : '', 72, doc.y, { width: width - 22 });
    if (item.instructions) doc.fontSize(9).fillColor(gray).text(item.instructions, 72, doc.y, { width: width - 22 });
    doc.moveDown(0.6);
  });
  if (p.instructions) {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text('Indicaciones', 50);
    doc.font('Helvetica').fontSize(10).text(p.instructions, 50, doc.y, { width });
  }

  // Pie: firma y verificación.
  const footerY = Math.max(doc.y + 30, doc.page.height - 190);
  const qr = await QRCode.toBuffer(verifyUrl, { margin: 0, width: 90, errorCorrectionLevel: 'M' });
  doc.image(qr, 50, footerY, { width: 80 });
  doc.font('Helvetica').fontSize(8).fillColor(gray)
    .text('Verifica esta receta en:', 140, footerY + 10, { width: 220 })
    .fillColor('#000').text(verifyUrl, { width: 220, link: verifyUrl })
    .fillColor(gray).text(`Código: ${p.code}`, { width: 220 });
  doc.moveTo(50 + width - 200, footerY + 55).lineTo(50 + width, footerY + 55).strokeColor('#000').stroke();
  doc.font('Helvetica').fontSize(9).fillColor('#000').text(doctor.displayName, 50 + width - 200, footerY + 60, { width: 200, align: 'center' })
    .fillColor(gray).text('Firma del médico', { width: 200, align: 'center' });

  if (p.voidedAt) {
    doc.save().rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] })
      .font('Helvetica-Bold').fontSize(90).fillColor('#b00020').opacity(0.25)
      .text('ANULADA', 0, doc.page.height / 2 - 50, { width: doc.page.width, align: 'center' }).restore();
  }
  doc.end();
  return done;
}
