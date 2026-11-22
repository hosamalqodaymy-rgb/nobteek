#!/usr/bin/env python3
"""Count + relational integrity verification of an ephemeral synthetic PostgreSQL restore.

Never prints individual rows, passwords, patient details or a dump. Both databases
are throwaway isolated CI databases. Credentials come only from CI environment.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

CONTAINER = os.environ["NOBTEEK_PG_CONTAINER"]
assert CONTAINER and CONTAINER.isalnum(), "Expected Docker container id"
SOURCE = "nobteek_test_ci"
TARGET = "nobteek_test_restore"
TABLES = [
    "clinics", "users", "memberships", "doctors", "clinic_sessions",
    "arrival_windows", "patients", "bookings", "visits", "audit_events",
    "outbox_messages", "command_replays", "ticket_tokens",
    "support_requests", "notification_simulations",
]
QUERY = "SELECT json_build_object(" + ",".join(
    "'%s',(SELECT count(*) FROM %s)" % (table, table) for table in TABLES
) + ")::text;"
RELATIONS = [
    """SELECT count(*) FROM bookings b
        LEFT JOIN patients p ON p.id=b.patient_id AND p.clinic_id=b.clinic_id
        WHERE p.id IS NULL;""",
    """SELECT count(*) FROM visits v
        LEFT JOIN bookings b ON b.id=v.booking_id AND b.clinic_id=v.clinic_id
        WHERE b.id IS NULL;""",
    """SELECT count(*) FROM outbox_messages o
        LEFT JOIN audit_events a ON a.id=o.event_id AND a.clinic_id=o.clinic_id
        WHERE a.id IS NULL;""",
    """SELECT count(*) FROM pg_constraint
        WHERE contype='f' AND NOT convalidated;""",
]
def sql(database, query):
    result = subprocess.run(["docker", "exec", CONTAINER, "psql", "-U",
        "postgres", "-d", database, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1",
        "-c", query], text=True, capture_output=True, check=True)
    return result.stdout.strip()

source = json.loads(sql(SOURCE, QUERY))
target = json.loads(sql(TARGET, QUERY))
assert source == target, "Synthetic restore table counts differ"
assert source["clinics"] >= 2 and source["visits"] >= 2
for check in RELATIONS:
    assert sql(TARGET, check) == "0", "Restored relational integrity failed"
assert sql(TARGET, "SELECT count(*) FROM migrations;") == sql(
    SOURCE, "SELECT count(*) FROM migrations;"), "Migration history missing"
report = {
    "phase": "P11", "test": "T11B",
    "source": "isolated_synthetic_postgres", "target": "independent_restored_database",
    "counts_equal": True, "foreign_key_orphans": 0,
    "unvalidated_foreign_keys": 0, "tables_verified": len(TABLES),
    "source_table_counts": source,
    "contains_real_patient_data": False,
    "dump_uploaded": False,
    "operational_production_restore_verified": False,
}
dest = Path(__file__).resolve().parent.parent / "results" / "p11-ci"
dest.mkdir(parents=True, exist_ok=True)
(dest / "restore.json").write_text(json.dumps(report, indent=2) + "\n")
print("P11 T11B: isolated synthetic restore counts and foreign keys matched")
