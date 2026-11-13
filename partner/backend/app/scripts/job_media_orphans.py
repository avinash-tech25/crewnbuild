"""Inspect the private job-photo directory against the database. Report-only by default.

    python -m app.scripts.job_media_orphans
    python -m app.scripts.job_media_orphans --delete-orphan-files [--min-age-minutes 60]

It lists
  * orphan files: an encrypted photo whose row no longer exists (a booking or
    account deleted by cascade, a removal whose file delete failed, a migration
    downgrade), and unfinished `.tmp` writes;
  * missing files: a row whose encrypted file is gone. Only reported -- this
    script never deletes or changes a database row.

With --delete-orphan-files it removes orphan files only, and only those that are
correctly named, unreferenced and older than --min-age-minutes (so an upload
being written right now is never touched). Nothing outside JOB_MEDIA_DIRECTORY
is read or removed, and nothing is decrypted. There is no schedule: run it by hand.
"""

import argparse
import re
import sys
import time

from app.database.session import SessionLocal
from app.modules.bookings.job_media_storage import job_media_root
from app.modules.bookings.models import ServiceRequestMedia
from app.modules.registry import import_all_models

import_all_models()

NAME = re.compile(r"^[0-9a-f]{48}\.(bin|tmp)$")


def inspect(session) -> dict:
    root = job_media_root()
    referenced = {key for (key,) in session.query(ServiceRequestMedia.storage_key)}
    files, unknown = {}, []
    if root.is_dir():
        for path in root.iterdir():
            if path.is_file() and NAME.match(path.name):
                files[path] = path.stem
            else:
                unknown.append(path.name)
    orphans = [path for path, key in files.items() if path.suffix == ".tmp" or key not in referenced]
    present = {key for path, key in files.items() if path.suffix == ".bin"}
    missing = sorted(referenced - present)
    return {
        "root": root,
        "files": len(files),
        "referenced": len(referenced),
        "orphans": orphans,
        "missing": missing,
        "unknown": unknown,
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--delete-orphan-files", action="store_true", help="remove orphan files (never database rows)")
    parser.add_argument(
        "--min-age-minutes", type=int, default=60, help="only files older than this are removed (default 60)"
    )
    args = parser.parse_args(argv)

    with SessionLocal() as session:
        report = inspect(session)
        session.rollback()

    print(f"Directory: {report['root']}")
    print(f"Photo files: {report['files']}  |  database rows: {report['referenced']}")
    print(f"Orphan files: {len(report['orphans'])}")
    print(f"Rows whose file is missing: {len(report['missing'])} (reported only)")
    for key in report["missing"]:
        print(f"  missing file for storage key {key[:8]}...")
    if report["unknown"]:
        print(f"Other entries left alone: {len(report['unknown'])}")

    if not args.delete_orphan_files:
        return 0
    cutoff = time.time() - max(args.min_age_minutes, 0) * 60
    removed = skipped = 0
    for path in report["orphans"]:
        if path.stat().st_mtime > cutoff:
            skipped += 1
            continue
        path.unlink(missing_ok=True)
        removed += 1
    print(f"Removed {removed} orphan file(s); kept {skipped} newer than {args.min_age_minutes} minutes.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
