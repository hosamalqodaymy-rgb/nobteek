/** Visual fixtures only: no account, authentication bypass, API, or real data. */
import { createInertiaApp } from '@inertiajs/react';
import { createRoot } from 'react-dom/client';
import Account from './pages/Account';
import Workspace from './pages/Workspace';
import Team from './pages/Team';
import Platform from './pages/Platform';
import ErrorPage from './pages/Error';
import '../css/app.css';
const params = new URLSearchParams(window.location.search);
const screen = params.get('screen') ?? 'login';
if (params.get('zoom') === '200') document.documentElement.style.fontSize = '200%';
const pageName = ['login', 'challenge', 'recovery', 'activation', 'security'].includes(screen) ? 'Account' : screen;
const names = ['welcome', 'login', 'challenge', 'recovery', 'account.access', 'security', 'logout', 'dashboard', 'clinic.select', 'team', 'team.create', 'platform', 'mfa.start', 'mfa.confirm', 'recovery.rotate', 'password.change', 'account.confirm'];
const links = Object.fromEntries(names.map(name => [name, `preview-frame.html?screen=${name === 'dashboard' ? 'Workspace' : name === 'team' ? 'Team' : name === 'platform' ? 'Platform' : name}`]));
const membership = { id: 'synthetic-membership', role: 'owner', display_name: 'عيادة ألف التجريبية' };
const props = {
  errors: {}, brand: { name: 'نوبتيك', tagline: 'يوم عيادتك بترتيب واضح' }, links, status: null, privateNotice: null,
  auth: ['login', 'challenge', 'recovery', 'activation'].includes(screen) ? null : { display_name: 'مالك تجريبي', username: 'visual_fixture_only', platform_admin: screen === 'Platform' },
  screen, mfa: { enabled: false, required: true, setup: null }, events: [{ event_type: 'login_succeeded', at: '2026-11-06T08:00:00+03:00' }],
  memberships: [membership], selectedMembership: membership.id,
  clinic: 'عيادة ألف التجريبية',
  members: [{ id: 'owner', username: 'owner_fixture', display_name: 'مالك العيادة التجريبي', role: 'owner', login_enabled: true, access_suspended: false, mfa_confirmed_at: null }, { id: 'reception', username: 'staff_fixture', display_name: 'موظف استقبال تجريبي', role: 'reception', login_enabled: false, access_suspended: false, mfa_confirmed_at: null }],
  owners: [{ id: 'owner', username: 'owner_fixture', display_name: 'مالك تجريبي', clinic: 'عيادة ألف التجريبية' }],
  statusCode: 403, message: 'لا تسمح صلاحيات حسابك بهذا الإجراء.',
};
const pages = { Account, Workspace, Team, Platform, Error: ErrorPage };
const root = document.getElementById('app')!;
root.setAttribute('data-page', JSON.stringify({ component: pageName, props: screen === 'Error' ? { ...props, status: 403 } : props, url: window.location.pathname + window.location.search, version: 'visual-fixture-only', flash: {} }));
createInertiaApp({ page: JSON.parse(root.getAttribute('data-page')!), resolve: name => pages[name as keyof typeof pages], setup({ el, App, props: initialProps }) { createRoot(el).render(<App {...initialProps} />); } });
