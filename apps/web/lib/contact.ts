// Datos de contacto comercial de Tepahti, mostrados en la página de inicio y el centro de ayuda.
export const CONTACT_EMAIL = 'contacto@nut.com.mx';
export const CONTACT_PHONE = '220 427 4405';
export const CONTACT_TEL = 'tel:+522204274405';

export function whatsappUrl(text = 'Hola, me interesa Tepahti para mi consultorio.') {
  return `https://wa.me/522204274405?text=${encodeURIComponent(text)}`;
}
