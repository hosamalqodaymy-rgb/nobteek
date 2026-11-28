import { Link, usePage } from '@inertiajs/react';
import { AccountLayout, type Shared } from '../components/AccountLayout';
import { CommunityForm, type CommunityField } from '../components/CommunityForm';

const professions = {
  physician: 'طب', laboratory: 'مختبرات طبية', pharmacy: 'صيدلة', nursing: 'تمريض',
  therapy: 'علاج طبيعي', imaging: 'أشعة وتصوير', dental: 'طب الأسنان', other: 'مهن صحية أخرى',
};
const workTypes = { full: 'دوام كامل', part: 'دوام جزئي', shifts: 'مناوبات' };
const advertStates = { pending: 'قيد المراجعة', published: 'منشور', revision: 'استكمال مطلوب', rejected: 'غير معتمد', closed: 'مغلق' };
const caseStates = {
  invited: 'دعوة من منشأة', applied: 'تم التقديم', shortlisted: 'القائمة المختصرة', interview: 'مقابلة محددة',
  offered: 'عرض وظيفي', accepted: 'العرض مقبول', hired: 'تأكدت المباشرة', declined: 'رُفض العرض أو الدعوة',
};
const tabNames = {
  cases: 'طلبات التوظيف', profile: 'ملفي المهني', posts: 'إعلاناتي', saved: 'المحفوظة',
  candidates: 'باحثون عن عمل', review: 'مراجعة الإعلانات', reports: 'البلاغات',
};

type Role = 'guest' | 'candidate' | 'employer' | 'moderator';
type Tab = keyof typeof tabNames;
type Advert = {
  id: string; kind: 'vacancy' | 'seeker'; title: string; profession: keyof typeof professions; specialty: string; area: string;
  branch: string | null; work_type: keyof typeof workTypes; deadline: string; description: string; requirements: string | null;
  state: keyof typeof advertStates; clinic_name: string | null; review_note?: string | null;
};
type Profile = {
  name: string; profession: keyof typeof professions; specialty: string; area: string; experience: number; bio: string | null; cv_name?: string | null;
};
type Case = { id: string; title: string; kind: Advert['kind']; state: keyof typeof caseStates; clinic_name: string };
type CaseDetail = Case & {
  profile_snapshot: Profile | null; candidate_message: string | null; invitation_message: string | null;
  interview_on: string | null; interview_location: string | null; starts_on: string | null; offer_details: string | null;
  candidate_started_at: string | null; employer_started_at: string | null;
};
type Report = { id: string; reason: string; advert_id: string; title: string };
type Application = { record: CaseDetail; fee: { amount_cents: number; currency: 'USD'; simulated: boolean } | null; hasProfile: boolean };
type AdvertDetail = { record: Advert; mine: boolean; open: boolean; saved: boolean };
type Urls = { browse: string; manage: string; store: string; directory: string | null };
type Props = {
  role: Role; clinicName: string | null; view: Tab | 'browse' | 'advert' | 'apply' | 'case'; tabs: Tab[]; today: string; urls: Urls;
  listing?: { data: (Advert | Case | Report)[]; prev_page_url: string | null; next_page_url: string | null };
  advert?: AdvertDetail; application?: Application; profession?: string | null; profile?: Profile | null; hasProfile?: boolean;
};

const choices = (items: Record<string, string>) => Object.entries(items).map(([value, label]) => ({ value, label }));
const date = (value: string) => new Intl.DateTimeFormat('ar-YE', { dateStyle: 'medium', timeZone: 'Asia/Aden' }).format(new Date(value + 'T12:00:00Z'));
const noteField: CommunityField = { name: 'message', label: 'رسالة إلى الطرف الآخر', type: 'textarea', required: false, maxLength: 450 };

function ProfileForm({ url, profile, returnAdvert }: { url: string; profile?: Profile | null; returnAdvert?: string }) {
  const hidden: Record<string, string> = { action: 'save_profile' };
  if (returnAdvert) hidden.return_advert = returnAdvert;
  return <CommunityForm action={url} hidden={hidden} submit="حفظ الملف المهني" resetAfterSave={false} fields={[
    { name: 'name', label: 'الاسم المهني', value: profile?.name, maxLength: 60 },
    { name: 'profession', label: 'المهنة', options: choices(professions), value: profile?.profession },
    { name: 'specialty', label: 'التخصص', value: profile?.specialty, maxLength: 70 },
    { name: 'area', label: 'المنطقة', value: profile?.area, maxLength: 60 },
    { name: 'experience', label: 'سنوات الخبرة', type: 'number', min: 0, max: 70, value: profile ? String(profile.experience) : '' },
    { name: 'bio', label: 'نبذة مهنية', type: 'textarea', value: profile?.bio ?? '', required: false, maxLength: 450 },
    { name: 'cv_name', label: 'اسم ملف سيرة تجريبية (اختياري)', value: profile?.cv_name ?? '', required: false, maxLength: 100 },
  ]} />;
}

function AdvertForm({ employer, advert, today, url }: { employer: boolean; advert?: Advert; today: string; url: string }) {
  const roleFields: CommunityField[] = employer ? [
    { name: 'profession', label: 'المهنة', options: choices(professions), value: advert?.profession },
    { name: 'specialty', label: 'التخصص المطلوب', value: advert?.specialty, maxLength: 70 },
    { name: 'branch', label: 'الفرع', value: advert?.branch ?? '', maxLength: 80 },
  ] : [];
  const hidden: Record<string, string> = { action: 'save_advert' };
  if (advert) hidden.id = advert.id;
  return <CommunityForm action={url} hidden={hidden} submit="إرسال الإعلان للمراجعة" fields={[
    { name: 'title', label: 'مسمى الإعلان', value: advert?.title, maxLength: 90 },
    ...roleFields,
    { name: 'area', label: 'المنطقة', value: advert?.area, maxLength: 60 },
    { name: 'work_type', label: 'نوع الدوام', options: choices(workTypes), value: advert?.work_type },
    { name: 'deadline', label: 'آخر يوم لاستقبال الطلبات', type: 'date', min: today, value: advert?.deadline },
    { name: 'description', label: 'وصف الإعلان', type: 'textarea', value: advert?.description, maxLength: 700 },
    ...(employer ? [
      { name: 'requirements', label: 'متطلبات التقديم', type: 'textarea' as const, value: advert?.requirements ?? '', maxLength: 400 },
    ] : [
      { name: 'consent', label: 'أوافق على عرض بطاقة البحث عن عمل للمنشآت المعتمدة.', type: 'checkbox' as const },
    ]),
  ]} />;
}

function ShareProfile({ action, id, url, includeCv }: { action: 'apply' | 'accept_invitation'; id: string; url: string; includeCv: boolean }) {
  return <CommunityForm action={url} hidden={{ action, id }} submit={action === 'apply' ? 'إرسال طلب التقديم' : 'قبول الدعوة ومشاركة الملف'} fields={[
    { ...noteField, label: 'رسالة إلى المنشأة' },
    { name: 'consent', label: 'أوافق على مشاركة نسخة من ملفي المهني مع هذه المنشأة.', type: 'checkbox' },
    ...(includeCv ? [{ name: 'include_cv', label: 'أضف اسم ملف السيرة التجريبية', type: 'checkbox' as const, required: false }] : []),
  ]} />;
}

function AdvertPage({ detail, role, loggedIn, urls, today }: { detail: AdvertDetail; role: Role; loggedIn: boolean; urls: Urls; today: string }) {
  const row = detail.record;
  const hidden = (action: string) => ({ action, id: row.id });
  return <>
    <section className="account-card">
      <div className="actions">
        <span className="state-pill">{professions[row.profession]}</span><span className="state-pill">{workTypes[row.work_type]}</span>
        {(detail.mine || role === 'moderator') && <span className="state-pill">{advertStates[row.state]}</span>}
      </div>
      <dl className="community-facts">
        <div><dt>التخصص</dt><dd>{row.specialty}</dd></div><div><dt>المنطقة</dt><dd>{row.area}</dd></div>
        {row.clinic_name && <div><dt>المنشأة</dt><dd>{row.clinic_name}</dd></div>}
        {row.branch && <div><dt>الفرع</dt><dd>{row.branch}</dd></div>}
        <div><dt>آخر موعد</dt><dd><time dateTime={row.deadline}>{date(row.deadline)}</time></dd></div>
      </dl>
      <p className="community-message">{row.description}</p>
      {row.requirements && <><h2>متطلبات التقديم</h2><p className="community-message">{row.requirements}</p></>}
      {row.review_note && <p className="account-alert account-warning community-message">{row.review_note}</p>}
      {detail.open && row.kind === 'vacancy' && (role === 'candidate' || !loggedIn) && <Link className="btn" href={urls.browse + '/' + row.id + '/apply'}>
        {loggedIn ? 'التقديم على الفرصة' : 'سجّل الدخول للتقديم'}
      </Link>}
    </section>
    {detail.open && row.kind === 'vacancy' && role === 'candidate' && <section className="account-card">
      <div className="actions"><CommunityForm action={urls.store} hidden={hidden(detail.saved ? 'remove' : 'save')} submit={detail.saved ? 'إزالة من المحفوظة' : 'حفظ الفرصة'} /></div>
      <details><summary>الإبلاغ عن الإعلان</summary><CommunityForm action={urls.store} hidden={hidden('report')} submit="إرسال البلاغ"
        fields={[{ name: 'reason', label: 'سبب البلاغ', type: 'textarea', maxLength: 250 }]} /></details>
    </section>}
    {detail.open && row.kind === 'seeker' && role === 'employer' && <section className="account-card"><h2>دعوة للتقديم</h2>
      <p className="muted">يظهر الملف المهني بعد موافقة المرشح على مشاركته مع منشأتك.</p>
      <CommunityForm action={urls.store} hidden={hidden('invite')} submit="إرسال دعوة" fields={[noteField]} />
    </section>}
    {detail.mine && row.state === 'revision' && <section className="account-card"><h2>استكمال الإعلان</h2>
      <AdvertForm employer={role === 'employer'} advert={row} today={today} url={urls.store} />
    </section>}
    {detail.mine && ['pending', 'published', 'revision'].includes(row.state) && <section className="account-card">
      <CommunityForm action={urls.store} hidden={hidden('close_advert')} submit="إغلاق الإعلان" />
    </section>}
    {role === 'moderator' && row.state === 'pending' && <section className="account-card"><h2>قرار المراجعة</h2>
      <CommunityForm action={urls.store} hidden={hidden('review_advert')} submit="حفظ قرار المراجعة" fields={[
        { name: 'decision', label: 'القرار', options: choices({ published: 'اعتماد الإعلان', revision: 'طلب استكمال', rejected: 'رفض الإعلان' }) },
        { name: 'note', label: 'ملاحظة للناشر', required: false, type: 'textarea', maxLength: 160 },
      ]} />
    </section>}
  </>;
}

function Placement({ application, role, today, urls }: { application: Application; role: Role; today: string; urls: Urls }) {
  const { record: row, fee, hasProfile } = application;
  const employer = role === 'employer';
  const profile = row.profile_snapshot;
  const confirmed = employer ? row.employer_started_at : row.candidate_started_at;
  const action = (name: string, submit: string, fields?: CommunityField[]) =>
    <CommunityForm action={urls.store} hidden={{ action: name, id: row.id }} submit={submit} fields={fields} />;

  return <>
    <section className="account-card">
      <div className="actions"><span className="state-pill">{caseStates[row.state]}</span><strong>{row.clinic_name}</strong></div>
      {row.invitation_message && <><h2>رسالة الدعوة</h2><p className="community-message">{row.invitation_message}</p></>}
      {profile && <><h2>الملف الذي وافق المرشح على مشاركته</h2><dl className="community-facts">
        <div><dt>الاسم</dt><dd>{profile.name}</dd></div><div><dt>التخصص</dt><dd>{profile.specialty}</dd></div>
        <div><dt>المنطقة</dt><dd>{profile.area}</dd></div><div><dt>سنوات الخبرة</dt><dd>{profile.experience}</dd></div>
        {profile.cv_name && <div><dt>اسم ملف السيرة التجريبية</dt><dd>{profile.cv_name}</dd></div>}
      </dl>{profile.bio && <p className="community-message">{profile.bio}</p>}</>}
      {row.candidate_message && <><h2>رسالة التقديم</h2><p className="community-message">{row.candidate_message}</p></>}
    </section>
    {row.interview_on && <section className="account-card"><h2>المقابلة</h2>
      <p><time dateTime={row.interview_on}>{date(row.interview_on)}</time> · {row.interview_location}</p>
    </section>}
    {row.starts_on && <section className="account-card"><h2>العرض الوظيفي</h2>
      <p>تاريخ المباشرة · <time dateTime={row.starts_on}>{date(row.starts_on)}</time></p>
      <p className="community-message">{row.offer_details}</p>
    </section>}
    {!employer && row.state === 'invited' && <section className="account-card"><h2>الرد على الدعوة</h2>
      {hasProfile ? <ShareProfile action="accept_invitation" id={row.id} url={urls.store} includeCv /> :
        <Link className="btn" href={urls.manage + '?tab=profile'}>أكمل ملفك المهني أولًا</Link>}
      <div className="actions">{action('decline_invitation', 'رفض الدعوة')}</div>
    </section>}
    {employer && row.state === 'applied' && <section className="account-card">{action('shortlist', 'إضافة إلى القائمة المختصرة')}</section>}
    {employer && row.state === 'shortlisted' && <section className="account-card"><h2>تحديد المقابلة</h2>{action('interview', 'حفظ موعد المقابلة', [
      { name: 'interview_on', label: 'تاريخ المقابلة', type: 'date', min: today },
      { name: 'interview_location', label: 'مكان المقابلة', maxLength: 100 },
    ])}</section>}
    {employer && row.state === 'interview' && <section className="account-card"><h2>إرسال عرض وظيفي</h2>{action('offer', 'إرسال العرض', [
      { name: 'starts_on', label: 'تاريخ المباشرة', type: 'date', min: row.interview_on && row.interview_on > today ? row.interview_on : today },
      { name: 'offer_details', label: 'تفاصيل العرض', type: 'textarea', maxLength: 450 },
    ])}</section>}
    {!employer && row.state === 'offered' && <section className="account-card"><h2>الرد على العرض</h2>
      <div className="actions">{action('accept', 'قبول العرض')}{action('decline_offer', 'رفض العرض')}</div>
    </section>}
    {row.state === 'accepted' && row.starts_on && <section className="account-card"><h2>تأكيد المباشرة</h2>
      {confirmed ? <p className="muted">حُفظ تأكيدك. بانتظار الطرف الآخر.</p> : row.starts_on > today
        ? <p className="muted">يتاح التأكيد عند حلول موعد المباشرة.</p> : action('confirm_start', 'تأكيد المباشرة')}
    </section>}
    {fee && <section className="account-card"><h2>رسوم التوظيف التجريبية</h2>
      <p><bdi>{fee.amount_cents / 100} {fee.currency}</bdi> · مبالغ المحاكاة لا تُحصّل.</p>
    </section>}
  </>;
}

export default function CommunityJobs({ role, clinicName, view, tabs, today, urls, listing, advert, application, profession, profile, hasProfile }: Props) {
  const { auth } = usePage<Shared>().props;
  const employer = role === 'employer';
  const sectionTitle = view === 'posts' && employer ? 'إعلانات المنشأة' : tabNames[view as Tab];
  const heading = advert?.record.title ?? application?.record.title ?? (view === 'browse' ? 'الوظائف الصحية' : sectionTitle);
  return <AccountLayout title={heading}>
    <div className="page-heading"><div><h1>{heading}</h1>{clinicName && <p className="muted">{clinicName}</p>}</div>
      {view !== 'browse' ? <Link href={urls.browse} className="btn btn--secondary">فرص العمل</Link>
        : urls.directory && <a className="btn btn--secondary" href={urls.directory}>دليل العيادات</a>}
    </div>
    {tabs.length > 0 && <nav className="actions community-tabs" aria-label="أقسام الوظائف">
      {tabs.map(tab => <Link key={tab} href={urls.manage + '?tab=' + tab} className={view === tab ? 'btn' : 'btn btn--secondary'}
        aria-current={view === tab ? 'page' : undefined}>{tab === 'posts' && employer ? 'إعلانات المنشأة' : tabNames[tab]}</Link>)}
    </nav>}
    {view === 'browse' && <section className="account-card"><form className="date-filter" action={urls.browse} method="get">
      <div className="account-field"><label htmlFor="job-profession">المهنة</label><select id="job-profession" name="profession" defaultValue={profession ?? ''}>
        <option value="">كل المهن</option>{choices(professions).map(entry => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
      </select></div><button className="btn" type="submit">تصفية الفرص</button>
    </form></section>}
    {view === 'profile' && <section className="account-card"><h2>المعلومات المهنية</h2>
      <p className="muted">يمكنك مشاركة ملفك مع منشأة عند التقديم أو قبول دعوتها.</p><ProfileForm url={urls.store} profile={profile} />
    </section>}
    {view === 'posts' && <details className="account-card"><summary>{employer ? 'إعلان وظيفة جديد' : 'بطاقة بحث عن عمل جديدة'}</summary>
      {employer || hasProfile ? <AdvertForm employer={employer} today={today} url={urls.store} />
        : <Link className="btn" href={urls.manage + '?tab=profile'}>أكمل ملفك المهني أولًا</Link>}
    </details>}
    {view === 'advert' && advert && <AdvertPage detail={advert} role={role} loggedIn={Boolean(auth)} urls={urls} today={today} />}
    {view === 'apply' && advert && <section className="account-card"><h2>{profile ? 'التقديم إلى المنشأة' : 'أكمل ملفك المهني للتقديم'}</h2>
      {profile ? <ShareProfile action="apply" id={advert.record.id} includeCv={Boolean(profile.cv_name)} url={urls.store} /> :
        <ProfileForm url={urls.store} returnAdvert={advert.record.id} />}
    </section>}
    {view === 'case' && application && <Placement application={application} role={role} today={today} urls={urls} />}
    {listing && <>
      {listing.data.length === 0 && <p className="account-card muted">{view === 'browse' ? 'لا توجد فرص منشورة تطابق الاختيار.' : 'لا توجد سجلات في هذه القائمة.'}</p>}
      <div className="clinic-grid">
        {listing.data.map(row => <article className="account-card job-card" key={row.id}>
          <h2><Link href={(view === 'cases' ? urls.manage : urls.browse) + '/' + ('reason' in row ? row.advert_id : row.id)}>{row.title}</Link></h2>
          {'reason' in row ? <>
            <p className="community-message">{row.reason}</p>
            <CommunityForm action={urls.store} hidden={{ action: 'resolve_report', id: row.id }} submit="حفظ مراجعة البلاغ" fields={[
              { name: 'hide', label: 'إخفاء الإعلان', type: 'checkbox', required: false },
            ]} />
          </> : <><p className="muted">{row.clinic_name ?? ('area' in row ? row.area : '')}{'specialty' in row && ' · ' + row.specialty}</p>
            {view !== 'browse' && <span className="state-pill">{'profession' in row ? advertStates[row.state] : caseStates[row.state]}</span>}
            {'deadline' in row && <p className="muted">آخر موعد · <time dateTime={row.deadline}>{date(row.deadline)}</time></p>}
          </>}
        </article>)}
      </div>
      <nav className="actions" aria-label="صفحات القائمة">
        {listing.prev_page_url && <Link className="btn btn--secondary" href={listing.prev_page_url}>الصفحة السابقة</Link>}
        {listing.next_page_url && <Link className="btn btn--secondary" href={listing.next_page_url}>الصفحة التالية</Link>}
      </nav>
    </>}
  </AccountLayout>;
}
