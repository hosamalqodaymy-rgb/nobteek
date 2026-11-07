"""In-memory reference for the frozen P00 rules.

No database, HTTP server, login, medical record, messaging or payment integration.
The lock and snapshots express atomic command semantics; PostgreSQL guarantees
must be implemented and independently tested in P03-P11.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
import secrets
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo


class Rejected(Exception):
    def __init__(self, status: int, code: str):
        super().__init__(code)
        self.status, self.code = status, code


@dataclass(frozen=True)
class Context:
    actor_id: str
    clinic_id: str
    anonymous_scope: str | None = None


def clock(value: str) -> datetime:
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def normalize_phone(value: str | None, required: bool = True) -> str | None:
    if value is None or not str(value).strip():
        if required:
            raise Rejected(422, 'contact_required')
        return None
    digits = str(value).translate(str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'))
    digits = re.sub(r'[\s()\-]', '', digits)
    if digits.startswith('+967'):
        digits = digits[4:]
    elif digits.startswith('00967'):
        digits = digits[5:]
    if not re.fullmatch(r'7[0-9]{8}', digits):
        raise Rejected(422, 'invalid_contact_shape')
    return '+967' + digits


class ReferenceClinic:
    MUTABLE = ('sessions', 'bookings', 'visits', 'tokens', 'events', 'outbox', 'counters')

    def __init__(self, fixtures: dict[str, Any]):
        self.clinics = {x['id']: copy.deepcopy(x) for x in fixtures['clinics']}
        self.actors = {x['id']: copy.deepcopy(x) for x in fixtures['actors']}
        self.doctors = {x['id']: copy.deepcopy(x) for x in fixtures['doctors']}
        self.sessions = {x['id']: copy.deepcopy(x) for x in fixtures['sessions']}
        self.bookings, self.visits, self.tokens = {}, {}, {}
        self.events, self.outbox, self.counters, self.cache = [], [], {}, {}
        self.lock = threading.RLock()
        for session in self.sessions.values():
            self.validate_session(session)
        ordered = sorted(self.sessions.values(), key=lambda row: row['starts_at'])
        for index, session in enumerate(ordered):
            for earlier in ordered[:index]:
                if session['clinic_id'] == earlier['clinic_id'] and session['doctor_id'] == earlier['doctor_id'] and clock(session['starts_at']) < clock(earlier['ends_at']):
                    raise Rejected(422, 'overlapping_doctor_sessions')

    @staticmethod
    def validate_session(s: dict) -> None:
        start, end = clock(s['starts_at']), clock(s['ends_at'])
        if start >= end or start.astimezone(ZoneInfo('Asia/Aden')).date() != end.astimezone(ZoneInfo('Asia/Aden')).date():
            raise Rejected(422, 'invalid_session_day')
        windows = sorted(s['windows'], key=lambda w: w['starts_at'])
        if not windows:
            raise Rejected(422, 'windows_required')
        last = start
        for window in windows:
            ws, we = clock(window['starts_at']), clock(window['ends_at'])
            if not isinstance(window['capacity'], int) or isinstance(window['capacity'], bool) or window['capacity'] < 1:
                raise Rejected(422, 'invalid_capacity')
            if ws < start or we > end or ws >= we or ws < last:
                raise Rejected(422, 'invalid_window')
            last = we

    def _id(self, kind: str) -> str:
        self.counters[kind] = self.counters.get(kind, 0) + 1
        return f'{kind}_{self.counters[kind]:04d}'

    def _actor(self, c: Context) -> dict:
        actor = self.actors.get(c.actor_id)
        if not actor:
            raise Rejected(401, 'authentication_required')
        if c.clinic_id not in self.clinics:
            raise Rejected(404, 'not_found')
        if actor['role'] not in ('public', 'platform_admin') and actor['clinic_id'] != c.clinic_id:
            raise Rejected(404, 'not_found')
        if actor['role'] == 'public' and not c.anonymous_scope:
            raise Rejected(401, 'anonymous_scope_required')
        return actor

    def _scope(self, records: dict, ident: str, c: Context) -> dict:
        row = records.get(ident)
        if row is None or row['clinic_id'] != c.clinic_id:
            raise Rejected(404, 'not_found')
        return row

    def _permit(self, c: Context, action: str, s: dict | None = None) -> None:
        a = self._actor(c)
        role = a['role']
        allowed = {
            'request': {'public', 'owner', 'reception'},
            'confirm': {'owner', 'reception'},
            'reject': {'owner', 'reception'},
            'cancel': {'owner', 'reception'},
            'reschedule': {'owner', 'reception'},
            'check_in': {'owner', 'reception'},
            'walk_in': {'owner', 'reception'},
            'mark_away': {'owner', 'reception', 'doctor'},
            'return': {'owner', 'reception'},
            'leave': {'owner', 'reception', 'doctor'},
            'call_next': {'doctor'},
            'start': {'doctor'},
            'complete': {'doctor'},
            'priority': {'doctor'},
            'open': {'owner'},
            'pause': {'owner', 'doctor'},
            'resume': {'owner', 'doctor'},
            'close': {'owner'},
            'capacity': {'owner'},
            'extend': {'owner'},
            'read_booking': {'owner', 'reception', 'doctor'},
        }
        permitted = role in allowed.get(action, set())
        if action == 'call_next' and role == 'reception' and a.get('can_call'):
            permitted = True
        if not permitted:
            raise Rejected(403, 'forbidden')
        if role == 'doctor' and s is not None and self.doctors[s['doctor_id']]['actor_id'] != c.actor_id:
            raise Rejected(404, 'not_found')

    @staticmethod
    def _version(row: dict, expected: int | None) -> None:
        if expected is None:
            raise Rejected(422, 'expected_version_required')
        if row['version'] != expected:
            raise Rejected(409, 'stale_version')

    @staticmethod
    def _not_closed(s: dict) -> None:
        if s['state'] == 'closed':
            raise Rejected(409, 'session_closed')

    def _accepting(self, s: dict, now: datetime, require_open: bool = False) -> None:
        self._not_closed(s)
        if now >= clock(s['ends_at']):
            raise Rejected(409, 'intake_ended')
        if require_open and (s['state'] not in ('open', 'paused') or now < clock(s['starts_at'])):
            raise Rejected(409, 'session_not_open')

    @staticmethod
    def _window(s: dict, window_id: str) -> dict:
        found = next((w for w in s['windows'] if w['id'] == window_id), None)
        if not found:
            raise Rejected(422, 'invalid_window')
        return found

    def _space(self, s: dict, window_id: str, exclude: str | None = None) -> None:
        w = self._window(s, window_id)
        occupied = [b for b in self.bookings.values() if b['session_id'] == s['id'] and b['state'] in ('confirmed', 'fulfilled') and b['id'] != exclude]
        if sum(b['window_id'] == window_id for b in occupied) >= w['capacity']:
            raise Rejected(409, 'capacity_full')
        if len(occupied) >= sum(x['capacity'] for x in s['windows']):
            raise Rejected(409, 'capacity_full')

    def _event(self, c: Context, kind: str, entity_id: str, now: datetime, reason: str | None = None) -> None:
        event = {'id': self._id('event'), 'clinic_id': c.clinic_id, 'actor_id': c.actor_id,
                 'type': kind, 'entity_id': entity_id, 'at': now.isoformat(), 'reason': reason}
        self.events.append(event)
        self.outbox.append({'event_id': event['id'], 'external_delivery': 'disabled'})

    def execute(self, c: Context, command: str, ident: str, body: dict | None = None,
                *, key: str, expected: int | None = None, now: datetime) -> dict:
        body = copy.deepcopy(body or {})
        with self.lock:
            self._actor(c)
            if not key or len(key) > 128:
                raise Rejected(422, 'idempotency_key_required')
            if 'clinic_id' in body:
                raise Rejected(422, 'clinic_context_is_server_owned')
            fingerprint = json.dumps([command, ident, body, expected], sort_keys=True, ensure_ascii=False)
            subject = ('anonymous/' + c.anonymous_scope) if self.actors[c.actor_id]['role'] == 'public' else ('actor/' + c.actor_id)
            cachekey = (c.clinic_id, subject, key)
            if cachekey in self.cache:
                previous = self.cache[cachekey]
                if previous[0] != fingerprint:
                    raise Rejected(409, 'idempotency_key_reused')
                self._recheck_cached_access(c, command, ident, body)
                return copy.deepcopy(previous[1])
            snapshot = {name: copy.deepcopy(getattr(self, name)) for name in self.MUTABLE}
            try:
                result = self._execute(c, command, ident, body, expected, now)
                self.invariants()
            except Exception:
                for name, state in snapshot.items():
                    setattr(self, name, state)
                raise
            self.cache[cachekey] = (fingerprint, copy.deepcopy(result))
            return result

    def _recheck_cached_access(self, c: Context, command: str, ident: str, body: dict) -> None:
        if command in ('request', 'walk_in', 'call_next', 'open', 'pause', 'resume', 'close', 'capacity', 'extend'):
            s = self._scope(self.sessions, ident, c)
        elif command in ('confirm', 'reject', 'cancel', 'reschedule', 'check_in'):
            b = self._scope(self.bookings, ident, c)
            s = self._scope(self.sessions, b['session_id'], c)
        else:
            v = self._scope(self.visits, ident, c)
            s = self._scope(self.sessions, v['session_id'], c)
        self._permit(c, command, s)

    def _request(self, c: Context, s: dict, body: dict, now: datetime) -> dict:
        self._permit(c, 'request', s)
        self._accepting(s, now)
        w = self._window(s, body.get('window_id', ''))
        if now >= clock(w['ends_at']):
            raise Rejected(409, 'window_ended')
        name = str(body.get('display_name', '')).strip()
        if not 2 <= len(name) <= 80:
            raise Rejected(422, 'invalid_display_name')
        source = 'web' if self._actor(c)['role'] == 'public' else body.get('source', 'phone')
        if source not in ('web', 'phone', 'walk_in'):
            raise Rejected(422, 'invalid_source')
        phone = normalize_phone(body.get('contact_phone'), required=source != 'walk_in')
        ident = self._id('booking')
        b = {'id': ident, 'clinic_id': c.clinic_id, 'session_id': s['id'], 'window_id': w['id'],
             'display_name': name, 'contact_phone': phone, 'source': source,
             'state': 'pending', 'version': 1, 'visit_id': None}
        self.bookings[ident] = b
        secret = secrets.token_urlsafe(32)
        self.tokens[hashlib.sha256(secret.encode()).hexdigest()] = {'booking_id': ident}
        self._event(c, 'booking.requested', ident, now)
        return {'booking_id': ident, 'state': 'pending', 'version': 1, 'ticket_number': None, 'secret': secret}

    def _execute(self, c: Context, cmd: str, ident: str, body: dict, expected: int | None, now: datetime) -> dict:
        if cmd in ('request', 'walk_in', 'call_next', 'open', 'pause', 'resume', 'close', 'capacity', 'extend'):
            s = self._scope(self.sessions, ident, c)
            self._permit(c, cmd, s)
        elif cmd in ('confirm', 'reject', 'cancel', 'reschedule', 'check_in'):
            b = self._scope(self.bookings, ident, c)
            s = self._scope(self.sessions, b['session_id'], c)
            self._permit(c, cmd, s)
        else:
            v = self._scope(self.visits, ident, c)
            s = self._scope(self.sessions, v['session_id'], c)
            self._permit(c, cmd, s)
        if cmd == 'request':
            return self._request(c, s, body, now)
        if cmd == 'walk_in':
            self._accepting(s, now, require_open=True)
            window = next((w for w in s['windows'] if clock(w['starts_at']) <= now < clock(w['ends_at'])), None)
            if window is None:
                raise Rejected(409, 'no_current_window')
            self._space(s, window['id'])
            result = self._request(c, s, {**body, 'source': 'walk_in', 'window_id': window['id']}, now)
            b = self.bookings[result['booking_id']]
            b['state'], b['version'] = 'confirmed', 2
            visit = self._check_in(c, b, s, now)
            return {**visit, 'booking_id': b['id'], 'secret': result['secret']}
        if cmd in ('open', 'pause', 'resume', 'close', 'capacity', 'extend'):
            self._version(s, expected)
            self._not_closed(s)
            if cmd in ('pause', 'resume', 'close') and not str(body.get('reason', '')).strip():
                raise Rejected(422, 'reason_required')
            if cmd == 'open':
                if s['state'] != 'scheduled' or not clock(s['starts_at']) <= now < clock(s['ends_at']):
                    raise Rejected(409, 'invalid_transition')
                s['state'] = 'open'
            elif cmd == 'pause':
                if s['state'] != 'open':
                    raise Rejected(409, 'invalid_transition')
                s['state'] = 'paused'
            elif cmd == 'resume':
                if s['state'] != 'paused':
                    raise Rejected(409, 'invalid_transition')
                s['state'] = 'open'
            elif cmd == 'close':
                if any(v['session_id'] == ident and v['state'] in ('waiting', 'away', 'called', 'in_service') for v in self.visits.values()):
                    raise Rejected(409, 'unresolved_visits')
                s['state'] = 'closed'
            elif cmd == 'capacity':
                if not str(body.get('reason', '')).strip():
                    raise Rejected(422, 'reason_required')
                w = self._window(s, body.get('window_id', ''))
                count = sum(b['session_id'] == ident and b['window_id'] == w['id'] and b['state'] in ('confirmed', 'fulfilled') for b in self.bookings.values())
                cap = body.get('capacity')
                if not isinstance(cap, int) or isinstance(cap, bool) or cap < 1:
                    raise Rejected(422, 'invalid_capacity')
                if cap < count:
                    raise Rejected(409, 'capacity_below_reservations')
                w['capacity'] = cap
            else:
                if not str(body.get('reason', '')).strip():
                    raise Rejected(422, 'reason_required')
                candidate = clock(body['ends_at'])
                if candidate <= clock(s['ends_at']) or candidate.astimezone(ZoneInfo('Asia/Aden')).date() != clock(s['starts_at']).astimezone(ZoneInfo('Asia/Aden')).date():
                    raise Rejected(422, 'invalid_extension')
                # Extending the intake boundary does not silently extend windows or add capacity.
                s['ends_at'] = candidate.isoformat()
            s['version'] += 1
            self._event(c, 'session.' + cmd, ident, now, body.get('reason'))
            return {'session_id': ident, 'state': s['state'], 'version': s['version']}
        if cmd in ('confirm', 'reject', 'cancel', 'reschedule', 'check_in'):
            self._version(b, expected)
            self._not_closed(s)
            if cmd == 'confirm':
                self._accepting(s, now)
                if b['state'] != 'pending':
                    raise Rejected(409, 'invalid_transition')
                w = self._window(s, b['window_id'])
                if now >= clock(w['ends_at']):
                    raise Rejected(409, 'window_ended')
                self._space(s, w['id'])
                b['state'] = 'confirmed'
            elif cmd == 'reject':
                if b['state'] != 'pending' or not body.get('reason'):
                    raise Rejected(409 if b['state'] != 'pending' else 422, 'invalid_rejection')
                b['state'] = 'rejected'
            elif cmd == 'cancel':
                if b['state'] not in ('pending', 'confirmed'):
                    raise Rejected(409, 'invalid_transition')
                if not str(body.get('reason', '')).strip():
                    raise Rejected(422, 'reason_required')
                if b['visit_id']:
                    linked = self.visits[b['visit_id']]
                    if linked['state'] in ('in_service', 'completed'):
                        raise Rejected(409, 'visit_already_started')
                    linked['state'], linked['version'] = 'left', linked['version'] + 1
                b['state'] = 'cancelled'
            elif cmd == 'reschedule':
                if b['state'] not in ('pending', 'confirmed') or b['visit_id'] is not None:
                    raise Rejected(409, 'arrival_already_recorded')
                if not str(body.get('reason', '')).strip():
                    raise Rejected(422, 'reason_required')
                target = self._scope(self.sessions, body.get('session_id', ''), c)
                self._accepting(target, now)
                w = self._window(target, body.get('window_id', ''))
                if now >= clock(w['ends_at']):
                    raise Rejected(409, 'window_ended')
                if b['state'] == 'confirmed':
                    self._space(target, w['id'], exclude=b['id'])
                b['session_id'], b['window_id'] = target['id'], w['id']
            else:
                return self._check_in(c, b, s, now)
            b['version'] += 1
            self._event(c, 'booking.' + cmd, ident, now, body.get('reason'))
            return {'booking_id': ident, 'state': b['state'], 'version': b['version']}
        self._not_closed(s)
        if cmd == 'call_next':
            self._version(s, expected)
            if s['state'] != 'open':
                raise Rejected(409, 'session_not_open')
            if any(v['doctor_id'] == s['doctor_id'] and v['state'] in ('called', 'in_service') for v in self.visits.values()):
                raise Rejected(409, 'doctor_busy')
            ready = self.ready(s['id'])
            if not ready:
                raise Rejected(409, 'queue_empty')
            v = ready[0]
            v['state'], v['called_at'], v['version'] = 'called', now.isoformat(), v['version'] + 1
            s['version'] += 1
        else:
            self._version(v, expected)
            if cmd == 'start':
                if v['state'] != 'called':
                    raise Rejected(409, 'invalid_transition')
                v['state'], v['started_at'] = 'in_service', now.isoformat()
            elif cmd == 'complete':
                if v['state'] != 'in_service':
                    raise Rejected(409, 'invalid_transition')
                v['state'], v['completed_at'] = 'completed', now.isoformat()
                b = self.bookings[v['booking_id']]
                b['state'], b['version'] = 'fulfilled', b['version'] + 1
            elif cmd in ('mark_away', 'leave'):
                if v['state'] not in ('waiting', 'called', 'away') or not str(body.get('reason', '')).strip():
                    raise Rejected(409 if v['state'] not in ('waiting', 'called', 'away') else 422, 'invalid_absence')
                if cmd == 'mark_away' and v['state'] == 'away':
                    raise Rejected(409, 'invalid_transition')
                v['state'] = 'away' if cmd == 'mark_away' else 'left'
            elif cmd == 'return':
                if v['state'] != 'away':
                    raise Rejected(409, 'invalid_transition')
                v['state'], v['priority'], v['ready_seq'] = 'waiting', False, self._next_ready(s['id'])
                v['returned_at'] = now.isoformat()
            elif cmd == 'priority':
                if v['state'] != 'waiting' or body.get('reason') != 'clinical_priority':
                    raise Rejected(409 if v['state'] != 'waiting' else 422, 'invalid_priority')
                v['priority'], v['ready_seq'] = True, self._next_ready(s['id'])
            else:
                raise Rejected(422, 'unknown_command')
            v['version'] += 1
        self._event(c, 'visit.' + cmd, v['id'], now, body.get('reason'))
        return {'visit_id': v['id'], 'state': v['state'], 'ticket_number': v['ticket_number'], 'version': v['version']}

    def _next_ready(self, session_id: str) -> int:
        k = 'ready_' + session_id
        self.counters[k] = self.counters.get(k, 0) + 1
        return self.counters[k]

    def _check_in(self, c: Context, b: dict, s: dict, now: datetime) -> dict:
        self._accepting(s, now, require_open=True)
        if b['state'] != 'confirmed' or b['visit_id'] is not None:
            raise Rejected(409, 'arrival_already_recorded')
        w = self._window(s, b['window_id'])
        if now < clock(w['starts_at']):
            raise Rejected(409, 'arrival_window_not_started')
        counter = 'ticket_' + s['id']
        self.counters[counter] = self.counters.get(counter, 0) + 1
        ident = self._id('visit')
        v = {'id': ident, 'clinic_id': c.clinic_id, 'session_id': s['id'], 'doctor_id': s['doctor_id'],
             'booking_id': b['id'], 'state': 'waiting', 'version': 1, 'ticket_number': self.counters[counter],
             'ready_seq': self._next_ready(s['id']), 'priority': False, 'arrived_at': now.isoformat(),
             'called_at': None, 'started_at': None, 'completed_at': None, 'returned_at': None}
        self.visits[ident] = v
        b['visit_id'], b['version'] = ident, b['version'] + 1
        self._event(c, 'visit.check_in', ident, now)
        return {'visit_id': ident, 'state': 'waiting', 'ticket_number': v['ticket_number'], 'version': v['version']}

    def ready(self, session_id: str) -> list[dict]:
        return sorted((v for v in self.visits.values() if v['session_id'] == session_id and v['state'] == 'waiting'),
                      key=lambda v: (not v['priority'], v['ready_seq']))

    def read_booking(self, c: Context, booking_id: str) -> dict:
        with self.lock:
            self._actor(c)
            b = self._scope(self.bookings, booking_id, c)
            s = self._scope(self.sessions, b['session_id'], c)
            self._permit(c, 'read_booking', s)
            return copy.deepcopy(b)

    def ticket(self, secret: str, *, now: datetime) -> dict:
        with self.lock:
            token = self.tokens.get(hashlib.sha256(secret.encode()).hexdigest())
            if token is None:
                raise Rejected(404, 'not_found')
            b = self.bookings[token['booking_id']]
            s = self.sessions[b['session_id']]
            if now >= clock(s['ends_at']) + timedelta(hours=48):
                raise Rejected(404, 'not_found')
            v = self.visits.get(b['visit_id'])
            ahead = None
            if v and v['state'] == 'waiting':
                ahead = next(i for i, x in enumerate(self.ready(s['id'])) if x['id'] == v['id'])
            active = next((x for x in self.visits.values() if x['doctor_id'] == s['doctor_id'] and x['state'] in ('called', 'in_service')), None)
            return {'booking_state': b['state'], 'visit_state': v['state'] if v else None,
                    'ticket_number': v['ticket_number'] if v else None, 'waiting_ahead': ahead,
                    'doctor_state': active['state'] if active else 'available', 'session_state': s['state'],
                    'window_starts_at': self._window(s, b['window_id'])['starts_at'],
                    'window_ends_at': self._window(s, b['window_id'])['ends_at'],
                    'server_time': now.isoformat(), 'booking_version': b['version'],
                    'visit_version': v['version'] if v else None}

    def invariants(self) -> None:
        for s in self.sessions.values():
            for w in s['windows']:
                n = sum(b['session_id'] == s['id'] and b['window_id'] == w['id'] and b['state'] in ('confirmed', 'fulfilled') for b in self.bookings.values())
                assert n <= w['capacity'], 'window_capacity_exceeded'
        pairs = [(v['session_id'], v['ticket_number']) for v in self.visits.values()]
        assert len(pairs) == len(set(pairs)), 'ticket_number_reused'
        active = [v['doctor_id'] for v in self.visits.values() if v['state'] in ('called', 'in_service')]
        assert len(active) == len(set(active)), 'doctor_double_occupied'
        for v in self.visits.values():
            b, s = self.bookings[v['booking_id']], self.sessions[v['session_id']]
            assert b['clinic_id'] == v['clinic_id'] == s['clinic_id']
            assert b['visit_id'] == v['id'] and b['session_id'] == s['id']
            assert v['doctor_id'] == s['doctor_id']
            if v['state'] == 'completed':
                assert b['state'] == 'fulfilled' and v['started_at'] and v['completed_at']
