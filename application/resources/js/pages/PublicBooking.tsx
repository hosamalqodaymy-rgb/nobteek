import { usePage } from '@inertiajs/react';
import { AccountLayout, type Shared } from '../components/AccountLayout';
import { BookingRequestForm, type BookingOption } from '../components/BookingForms';
export default function PublicBooking() {
  const { clinic, sessions, request_url } = usePage<Shared & { clinic: { display_name: string; city: string; address_landmark: string; contact_phone: string | null }; sessions: BookingOption[]; request_url: string }>().props;
  return <AccountLayout title="طلب حجز" narrow>
    <div className="page-heading"><p className="eyebrow">طلب حجز لدى العيادة</p><h1>{clinic.display_name}</h1><p className="muted">{clinic.city} · {clinic.address_landmark}</p>{clinic.contact_phone && <p>تواصل العيادة: <a href={`tel:${clinic.contact_phone}`} dir="ltr">{clinic.contact_phone}</a></p>}</div>
    <section className="account-card"><h2>اختر نافذة وصول مناسبة</h2><p>ترسل بياناتك لهذه العيادة لمراجعة الطلب. لا تكتب تشخيصًا أو تفاصيل طبية.</p>{sessions.length ? <BookingRequestForm sessions={sessions} url={request_url} /> : <p className="account-alert account-warning" role="status">لا توجد نوافذ وصول متاحة لطلبات جديدة حاليًا. تواصل مع العيادة.</p>}</section>
  </AccountLayout>;
}
