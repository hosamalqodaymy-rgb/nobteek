-- Nobteek P03: structural integrity only; command authorization and locking
-- are implemented and tested in their later owning phases.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 username varchar(80) NOT NULL,
 display_name varchar(80) NOT NULL,
 password varchar(255),
 login_enabled boolean NOT NULL DEFAULT false,
 platform_role varchar(32) CHECK (platform_role IS NULL OR platform_role = 'platform_admin'),
 remember_token varchar(100),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (NOT login_enabled OR password IS NOT NULL)
);
CREATE UNIQUE INDEX users_username_lower_unique ON users (lower(username));

CREATE TABLE clinics (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 demo_code varchar(40) UNIQUE,
 display_name varchar(120) NOT NULL,
 city varchar(80) NOT NULL DEFAULT '',
 address_landmark varchar(240) NOT NULL DEFAULT '',
 contact_phone varchar(13),
 timezone varchar(40) NOT NULL DEFAULT 'Asia/Aden' CHECK (timezone = 'Asia/Aden'),
 operational_state varchar(16) NOT NULL DEFAULT 'active' CHECK (operational_state IN ('active','suspended')),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 clinic_id uuid NOT NULL REFERENCES clinics(id),
 user_id uuid NOT NULL REFERENCES users(id),
 role varchar(20) NOT NULL CHECK (role IN ('owner','reception','doctor')),
 active boolean NOT NULL DEFAULT true,
 delegated_permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE (clinic_id,id),
 UNIQUE (clinic_id,user_id),
 UNIQUE (clinic_id,user_id,role),
 CHECK (jsonb_typeof(delegated_permissions) = 'object'),
 CHECK (delegated_permissions - 'call_next' = '{}'::jsonb),
 CHECK (NOT (delegated_permissions ? 'call_next') OR
   (role = 'reception' AND jsonb_typeof(delegated_permissions->'call_next') = 'boolean'))
);

CREATE TABLE doctors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 clinic_id uuid NOT NULL REFERENCES clinics(id),
 user_id uuid NOT NULL REFERENCES users(id),
 membership_role varchar(20) NOT NULL DEFAULT 'doctor' CHECK (membership_role = 'doctor'),
 demo_code varchar(40) UNIQUE,
 display_name varchar(80) NOT NULL,
 specialty_optional varchar(120),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE (clinic_id,id),
 UNIQUE (clinic_id,user_id),
 FOREIGN KEY (clinic_id,user_id,membership_role) REFERENCES memberships(clinic_id,user_id,role)
);

CREATE TABLE clinic_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 clinic_id uuid NOT NULL REFERENCES clinics(id),
 doctor_id uuid NOT NULL,
 demo_code varchar(40) UNIQUE,
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 state varchar(20) NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled','open','paused','closed')),
 version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
 ticket_counter bigint NOT NULL DEFAULT 0 CHECK (ticket_counter >= 0),
 ready_counter bigint NOT NULL DEFAULT 0 CHECK (ready_counter >= 0),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE (clinic_id,id),
 UNIQUE (clinic_id,id,doctor_id),
 FOREIGN KEY (clinic_id,doctor_id) REFERENCES doctors(clinic_id,id),
 CHECK (ends_at > starts_at),
 CHECK ((starts_at AT TIME ZONE 'Asia/Aden')::date = (ends_at AT TIME ZONE 'Asia/Aden')::date),
 EXCLUDE USING gist (clinic_id WITH =,doctor_id WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&)
);

CREATE TABLE arrival_windows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 clinic_id uuid NOT NULL REFERENCES clinics(id),
 session_id uuid NOT NULL,
 demo_code varchar(40) UNIQUE,
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 capacity integer NOT NULL CHECK (capacity > 0),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE (clinic_id,id),
 UNIQUE (clinic_id,id,session_id),
 FOREIGN KEY (clinic_id,session_id) REFERENCES clinic_sessions(clinic_id,id),
 CHECK (ends_at > starts_at),
 EXCLUDE USING gist (session_id WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&)
);

-- Deferred checks cover edits to either parent or child within one transaction.
CREATE OR REPLACE FUNCTION nobteek_check_window_bounds() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE affected_session uuid; affected_clinic uuid;
BEGIN
 IF TG_TABLE_NAME = 'arrival_windows' THEN
  affected_session := NEW.session_id; affected_clinic := NEW.clinic_id;
 ELSE
  affected_session := NEW.id; affected_clinic := NEW.clinic_id;
 END IF;
 IF EXISTS (
  SELECT 1 FROM arrival_windows w JOIN clinic_sessions s
   ON s.clinic_id=w.clinic_id AND s.id=w.session_id
  WHERE w.clinic_id=affected_clinic AND w.session_id=affected_session
   AND (w.starts_at < s.starts_at OR w.ends_at > s.ends_at)
 ) THEN RAISE EXCEPTION 'arrival window outside session' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER arrival_window_bounds AFTER INSERT OR UPDATE ON arrival_windows
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION nobteek_check_window_bounds();
CREATE CONSTRAINT TRIGGER session_window_bounds AFTER UPDATE ON clinic_sessions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION nobteek_check_window_bounds();

CREATE TABLE patients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 clinic_id uuid NOT NULL REFERENCES clinics(id),
 demo_code varchar(40) UNIQUE,
 display_name varchar(80) NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 2 AND 80),
 contact_phone varchar(13),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE (clinic_id,id),
 CHECK (contact_phone IS NULL OR contact_phone ~ '^\+9677[0-9]{8}$')
);
CREATE INDEX patients_clinic_phone_index ON patients(clinic_id,contact_phone);

CREATE TABLE bookings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 clinic_id uuid NOT NULL REFERENCES clinics(id),
 patient_id uuid NOT NULL,
 session_id uuid NOT NULL,
 window_id uuid NOT NULL,
 demo_code varchar(40) UNIQUE,
 source varchar(16) NOT NULL CHECK (source IN ('web','phone','walk_in')),
 state varchar(20) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','confirmed','rejected','cancelled','fulfilled')),
 version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
 visit_id uuid,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE (clinic_id,id),
 UNIQUE (clinic_id,id,session_id),
 FOREIGN KEY (clinic_id,patient_id) REFERENCES patients(clinic_id,id),
 FOREIGN KEY (clinic_id,session_id) REFERENCES clinic_sessions(clinic_id,id),
 FOREIGN KEY (clinic_id,window_id,session_id) REFERENCES arrival_windows(clinic_id,id,session_id)
);
CREATE INDEX bookings_session_state_index ON bookings(clinic_id,session_id,state);

CREATE TABLE visits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 clinic_id uuid NOT NULL REFERENCES clinics(id),
 booking_id uuid NOT NULL UNIQUE,
 session_id uuid NOT NULL,
 doctor_id uuid NOT NULL,
 ticket_number bigint NOT NULL CHECK (ticket_number > 0),
 ready_sequence bigint NOT NULL CHECK (ready_sequence > 0),
 priority boolean NOT NULL DEFAULT false,
 state varchar(20) NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting','called','in_service','away','completed','left')),
 version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
 arrived_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 called_at timestamptz,
 started_at timestamptz,
 completed_at timestamptz,
 returned_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE (clinic_id,id),
 UNIQUE (clinic_id,id,booking_id),
 UNIQUE (session_id,ticket_number),
 FOREIGN KEY (clinic_id,booking_id,session_id) REFERENCES bookings(clinic_id,id,session_id),
 FOREIGN KEY (clinic_id,session_id,doctor_id) REFERENCES clinic_sessions(clinic_id,id,doctor_id),
 CHECK (started_at IS NULL OR started_at >= arrived_at),
 CHECK (completed_at IS NULL OR (started_at IS NOT NULL AND completed_at >= started_at))
);
CREATE UNIQUE INDEX visits_one_active_per_doctor ON visits(doctor_id) WHERE state IN ('called','in_service');
CREATE UNIQUE INDEX visits_waiting_sequence ON visits(session_id,ready_sequence) WHERE state='waiting';
CREATE INDEX visits_ready_queue_index ON visits(clinic_id,session_id,ready_sequence) WHERE state='waiting';
ALTER TABLE bookings ADD CONSTRAINT bookings_visit_matches_booking
 FOREIGN KEY(clinic_id,visit_id,id) REFERENCES visits(clinic_id,id,booking_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE ticket_tokens (
 digest char(64) PRIMARY KEY CHECK (digest ~ '^[0-9a-f]{64}$'),
 clinic_id uuid NOT NULL REFERENCES clinics(id),
 booking_id uuid NOT NULL,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (clinic_id,booking_id) REFERENCES bookings(clinic_id,id)
);

CREATE TABLE audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 clinic_id uuid NOT NULL REFERENCES clinics(id),
 actor_membership_id uuid NOT NULL,
 entity_type varchar(40) NOT NULL,
 entity_id uuid NOT NULL,
 event_type varchar(80) NOT NULL,
 at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reason_code varchar(80),
 request_id uuid NOT NULL,
 safe_changes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_changes)='object'),
 UNIQUE (clinic_id,id),
 FOREIGN KEY(clinic_id,actor_membership_id) REFERENCES memberships(clinic_id,id)
);
CREATE INDEX audit_events_clinic_time_index ON audit_events(clinic_id,at);

CREATE TABLE outbox_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 clinic_id uuid NOT NULL REFERENCES clinics(id),
 event_id uuid NOT NULL UNIQUE,
 channel varchar(20) NOT NULL DEFAULT 'internal' CHECK (channel='internal'),
 status varchar(20) NOT NULL DEFAULT 'disabled' CHECK (status IN ('disabled','pending','processed','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
 next_attempt_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(clinic_id,event_id) REFERENCES audit_events(clinic_id,id)
);

CREATE TABLE command_replays (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 clinic_id uuid NOT NULL REFERENCES clinics(id),
 actor_scope_digest char(64) NOT NULL CHECK(actor_scope_digest ~ '^[0-9a-f]{64}$'),
 key_digest char(64) NOT NULL CHECK(key_digest ~ '^[0-9a-f]{64}$'),
 request_fingerprint char(64) NOT NULL CHECK(request_fingerprint ~ '^[0-9a-f]{64}$'),
 response_ciphertext text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at timestamptz NOT NULL,
 UNIQUE(clinic_id,actor_scope_digest,key_digest),
 CHECK(expires_at >= created_at + interval '48 hours')
);
