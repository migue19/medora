import { ClinicalRecord } from './ClinicalRecord';

export const metadata = { title: 'Expediente clínico', robots: { index: false, follow: false } };

export default function Page() {
  return <ClinicalRecord />;
}
