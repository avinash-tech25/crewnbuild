-- Create the database, the two service roles and the two schemas (technical-architecture.md 18, step 2).
-- Run once per machine as a PostgreSQL superuser:
--   psql -U postgres -f infrastructure\database\create_database_and_roles.sql
-- Replace both 'change-me' passwords before running, and put the same values in each backend's .env.
-- Tables, views and the cross-schema grants are created by each service's Alembic baseline (section 16),
-- Professional first, then Partner.

CREATE ROLE crewnbuild_professional LOGIN PASSWORD 'change-me';
CREATE ROLE crewnbuild_partner      LOGIN PASSWORD 'change-me';

-- ---- Application database ----
CREATE DATABASE crewnbuild;
\connect crewnbuild
CREATE SCHEMA professional AUTHORIZATION crewnbuild_professional;
CREATE SCHEMA partner      AUTHORIZATION crewnbuild_partner;
GRANT USAGE ON SCHEMA professional TO crewnbuild_partner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- ---- Test database (same layout) ----
\connect postgres
CREATE DATABASE crewnbuild_test;
\connect crewnbuild_test
CREATE SCHEMA professional AUTHORIZATION crewnbuild_professional;
CREATE SCHEMA partner      AUTHORIZATION crewnbuild_partner;
GRANT USAGE ON SCHEMA professional TO crewnbuild_partner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
