import { Link, router } from '@inertiajs/react';
import { AccountLayout } from '../components/AccountLayout';
import { CommunityForm } from '../components/CommunityForm';

const topics = { booking: 'الحجز والدور', account: 'الحساب', clinic: 'إضافة منشأة', subscription: 'الاشتراك', technical: 'مشكلة تقنية', other: 'استفسار آخر' };
const states = { open: 'بانتظار الرد', answered: 'أُجيب عنها', closed: 'مغلقة' };

type Ticket = { id: string; topic: keyof typeof topics; subject: string; state: keyof typeof states; updated_at: string };
type Thread = Ticket & { reference: string | null; assignee: string | null; messages: { id: number; author_role: 'patient' | 'support'; body: string; created_at: string }[] };
type Props = {
  role: 'patient' | 'support';
  filter: string;
  inbox: { data: Ticket[]; prev_page_url: string | null; next_page_url: string | null } | null;
  thread: Thread | null;
  agents: { id: string; display_name: string }[];
  supportUrl: string;
  threadUrl: string | null;
  directoryUrl: string | null;
};
const time = (value: string) => new Date(value).toLocaleString('ar-YE', { timeZone: 'Asia/Aden', dateStyle: 'medium', timeStyle: 'short' });

export default function CommunitySupport({ role, filter, inbox, thread, agents, supportUrl, threadUrl, directoryUrl }: Props) {
  const staff = role === 'support';
  const title = staff ? 'صندوق دعم المراجعين' : 'الدعم الفني';
  return <AccountLayout title={title}>
    <div className="page-heading"><div><h1>{thread ? 'محادثة الدعم' : title}</h1>
      <p className="muted">{staff ? 'التذاكر المسندة إليك والتذاكر المتاحة للإسناد.' : 'أرسل تذكرة وتابع رد فريق الدعم في حسابك.'}</p></div>
      {thread ? <Link className="btn btn--secondary" href={supportUrl}>{staff ? 'صندوق الدعم' : 'تذاكري'}</Link>
        : directoryUrl && <a className="btn btn--secondary" href={directoryUrl}>دليل العيادات</a>}
    </div>
    {!thread && !staff && <section className="account-card">
      <h2>فتح تذكرة دعم</h2>
      <CommunityForm action={supportUrl} submit="إرسال التذكرة" fields={[
        { name: 'topic', label: 'نوع الاستفسار', options: Object.entries(topics).map(([value, label]) => ({ value, label })) },
        { name: 'subject', label: 'عنوان التذكرة', maxLength: 80 },
        { name: 'reference', label: 'مرجع الحجز أو الطلب', required: false, maxLength: 60 },
        { name: 'body', label: 'وصف الاستفسار', type: 'textarea', maxLength: 1000 },
      ]} />
    </section>}
    {inbox && <section className="account-card">
      <div className="actions">
        <h2>{staff ? 'التذاكر' : 'تذاكري'}</h2>
        <button type="button" className="btn btn--secondary" onClick={() => router.reload({ only: ['inbox'] })}>تحديث القائمة</button>
      </div>
      <nav aria-label="تصفية التذاكر" className="actions">
        {[['open', 'المفتوحة'], ...(staff ? [['mine', 'المسندة إليّ']] : []), ['closed', 'المغلقة']].map(([value, label]) =>
          <Link key={value} href={supportUrl} data={{ filter: value }} aria-current={value === filter ? 'page' : undefined} className={value === filter ? 'btn' : 'btn btn--secondary'}>{label}</Link>)}
      </nav>
      {inbox.data.length === 0 ? <p className="muted">لا توجد تذاكر في هذه القائمة.</p> : <ul className="event-list">
        {inbox.data.map(item => <li key={item.id}><Link href={supportUrl + '/' + item.id}>{item.subject}</Link>
          <span className="muted">{topics[item.topic]} · {states[item.state]} · {time(item.updated_at)}</span></li>)}
      </ul>}
      <nav aria-label="صفحات التذاكر" className="actions">
        {inbox.prev_page_url && <Link className="btn btn--secondary" href={inbox.prev_page_url}>الصفحة السابقة</Link>}
        {inbox.next_page_url && <Link className="btn btn--secondary" href={inbox.next_page_url}>الصفحة التالية</Link>}
      </nav>
    </section>}
    {thread && threadUrl && <>
      <section className="account-card">
        <div className="actions"><h2>{thread.subject}</h2><span className="state-pill">{states[thread.state]}</span></div>
        <p className="muted">{topics[thread.topic]}{thread.reference && <> · مرجع <bdi>{thread.reference}</bdi></>}</p>
        {staff && <p>موظف الدعم · {thread.assignee ?? 'بانتظار الإسناد'}</p>}
        <button type="button" className="btn btn--secondary" onClick={() => router.reload({ only: ['thread', 'agents'] })}>تحديث المحادثة</button>
        {thread.messages.map(message => <article className="history-item account-card" key={message.id}>
          <strong>{message.author_role === 'support' ? 'فريق الدعم' : staff ? 'المراجع' : 'أنت'}</strong>
          <p className="muted"><time dateTime={message.created_at}>{time(message.created_at)}</time></p>
          <p className="community-message">{message.body}</p>
        </article>)}
      </section>
      {thread.state !== 'closed' && <section className="account-card">
        <h2>إضافة رد</h2>
        <CommunityForm key={thread.id} action={threadUrl} hidden={{ action: 'reply' }} submit="إرسال الرد"
          fields={[{ name: 'body', label: 'نص الرد', type: 'textarea', maxLength: 1000 }]} />
      </section>}
      {staff && thread.state !== 'closed' && <section className="account-card"><h2>إدارة التذكرة</h2>
        {agents.length > 0 && <CommunityForm key={thread.id} action={threadUrl} hidden={{ action: 'assign' }} submit="حفظ الإسناد"
          fields={[{ name: 'assignee', label: 'إسناد إلى موظف', options: agents.map(agent => ({ value: agent.id, label: agent.display_name })) }]} />}
        {thread.state === 'answered' && <CommunityForm action={threadUrl} hidden={{ action: 'close' }} submit="إغلاق التذكرة" />}
      </section>}
    </>}
  </AccountLayout>;
}
