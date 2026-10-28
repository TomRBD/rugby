-- Rôles et bases de développement (identiques à scripts/dev-db.sh)
CREATE ROLE rugby_admin LOGIN PASSWORD 'rugby_admin' CREATEDB;
CREATE ROLE rugby_app LOGIN PASSWORD 'rugby_app';
CREATE DATABASE rugby OWNER rugby_admin;
CREATE DATABASE rugby_test OWNER rugby_admin;
