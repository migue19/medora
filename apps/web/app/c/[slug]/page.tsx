import { BookingPage } from './BookingPage';

export const metadata = { title: 'Reservar cita' };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <BookingPage slug={slug} />;
}
