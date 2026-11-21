import { createInertiaApp } from '@inertiajs/react';
import { createRoot } from 'react-dom/client';
import Welcome from './pages/Welcome';
import Account from './pages/Account';
import Workspace from './pages/Workspace';
import Team from './pages/Team';
import Platform from './pages/Platform';
import ErrorPage from './pages/Error';
import PlatformClinics from './pages/PlatformClinics';
import ClinicSettings from './pages/ClinicSettings';
import SessionList from './pages/SessionList';
import SessionDetail from './pages/SessionDetail';
import BookingList from './pages/BookingList';
import PublicBooking from './pages/PublicBooking';
import Reception from './pages/Reception';
import { initializePrivateTicketFragment } from './components/PrivateTicketFragment';
import '../css/app.css';

initializePrivateTicketFragment();

createInertiaApp({
  resolve: (name) => {
    if (name === 'Doctor') return import('./pages/Doctor').then(module => module.default);
    if (name === 'Ticket') return import('./pages/Ticket').then(module => module.default);
    if (name === 'WaitingRoom') return import('./pages/WaitingRoom').then(module => module.default);
    if (name === 'Information') return import('./pages/Information').then(module => module.default);
    const pages = { Welcome, Account, Workspace, Team, Platform, Error: ErrorPage, PlatformClinics, ClinicSettings, SessionList, SessionDetail, BookingList, PublicBooking, Reception };
    if (name in pages) return pages[name as keyof typeof pages];
    throw new Error(`Unknown page: ${name}`);
  },
  setup({ el, App, props }) {
    createRoot(el).render(<App {...props} />);
  },
  progress: { color: 'var(--color-primary)' },
});
