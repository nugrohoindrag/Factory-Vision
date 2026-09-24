"""CV Vision dashboard: FastAPI + a static page, reading what the worker writes.

A separate process from the worker (`python -m fv_vision serve`), so it can
restart without interrupting detection. It reads the fv_vision database and
the live directory the worker publishes into, and writes only operator
decisions, accounts and the audit log.
"""
