import { createContext, useContext } from 'react';
import { router } from '@inertiajs/react';
import { postJSON, type JSONResult } from './SessionTransport';
export type BookingTransport = { post(url: string, data: Record<string, unknown>, headers?: Record<string, string>): Promise<JSONResult>; refresh(): void };
export const bookingTransport = createContext<BookingTransport>({ post: postJSON, refresh() { router.reload({ only: ['bookings', 'sessions', 'server_time'] }); } });
export const useBookingTransport = () => useContext(bookingTransport);
