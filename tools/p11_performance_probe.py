#!/usr/bin/env python3
"""Synthetic-only bounded repeatable latency measurement, not a production SLO."""
import json
import os
import statistics
import subprocess
import time
from pathlib import Path

container = os.environ["NOBTEEK_PG_CONTAINER"]
assert container.isalnum()
queries = {
    "queue_by_clinic": "SELECT count(*) FROM visits WHERE clinic_id=(SELECT id FROM clinics ORDER BY id LIMIT 1) AND state='waiting'",
    "booking_by_clinic": "SELECT count(*) FROM bookings WHERE clinic_id=(SELECT id FROM clinics ORDER BY id LIMIT 1) AND state='confirmed'",
    "audit_by_clinic": "SELECT count(*) FROM audit_events WHERE clinic_id=(SELECT id FROM clinics ORDER BY id LIMIT 1)",
    "notifications_by_event": "SELECT count(*) FROM outbox_messages WHERE status='disabled'",
}
sample = {}
for label, query in queries.items():
    times = []
    for _ in range(7):
        start = time.perf_counter()
        subprocess.run(["docker", "exec", container, "psql", "-U", "postgres",
                        "-d", "nobteek_test_ci", "-A", "-t", "-v", "ON_ERROR_STOP=1",
                        "-c", query], capture_output=True, text=True, check=True)
        times.append(round((time.perf_counter() - start) * 1000, 2))
    sample[label] = {"sample_count": 7, "median_ms": round(statistics.median(times), 2),
                     "max_ms": max(times)}
report = {"phase": "P11", "measured": True, "synthetic_only": True,
          "includes_docker_exec_overhead": True,
          "production_latency_slo_verified": False, "samples": sample}
output = Path(__file__).resolve().parent.parent / "results" / "p11-ci"
output.mkdir(parents=True, exist_ok=True)
(output / "performance.json").write_text(json.dumps(report, indent=2) + "\n")
print("P11 synthetic latency samples collected; no production SLA claimed")
