-- Rôles PostgreSQL : rugby_admin (propriétaire, migrations, worker) et rugby_app (API, soumis à la RLS)
CREATE ROLE rugby_admin LOGIN PASSWORD 'rugby_admin' CREATEDB;
CREATE ROLE rugby_app LOGIN PASSWORD 'rugby_app';
CREATE DATABASE rugby OWNER rugby_admin;
