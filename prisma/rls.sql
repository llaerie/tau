-- Tau AI CFO — PostgreSQL row-level security and immutability controls.
--
-- Applied by `npm run db:rls` (scripts/db-apply-rls.ts) after `prisma db push`. Idempotent.
--
-- Two controls live here because Prisma's schema language cannot express them:
--
--   1. Payroll detail (workers, payroll_runs, payroll_liabilities) is only visible to roles that
--      hold the VIEW_PAYROLL_DETAIL permission. The application announces the acting role per
--      transaction with `SET LOCAL app.role = '<Role>'`. Connections that set no role (system
--      jobs, seeding, the store's own load()) see everything; a connection that sets a role
--      without the permission sees zero rows and cannot insert/update/delete.
--
--   2. audit_events is append-only. UPDATE, DELETE and TRUNCATE raise, even for the table owner.
--      Sequence and hash uniqueness are enforced by the Prisma schema; the trigger closes the
--      remaining gap (owners bypass GRANT-based restrictions but not triggers).

-- ---------------------------------------------------------------------------
-- Permission table: which roles may see payroll detail
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tau_role_permissions (
  role       TEXT NOT NULL,
  permission TEXT NOT NULL,
  PRIMARY KEY (role, permission)
);

-- Mirrors PERMISSION_MATRIX in lib/security/rbac.ts (keep in sync).
DELETE FROM tau_role_permissions WHERE permission = 'VIEW_PAYROLL_DETAIL';
INSERT INTO tau_role_permissions (role, permission) VALUES
  ('OWNER',                'VIEW_PAYROLL_DETAIL'),
  ('CPA',                  'VIEW_PAYROLL_DETAIL'),
  ('PAYROLL_PROFESSIONAL', 'VIEW_PAYROLL_DETAIL'),
  ('AUDITOR',              'VIEW_PAYROLL_DETAIL'),
  ('SYSTEM',               'VIEW_PAYROLL_DETAIL'),
  ('AGENT',                'VIEW_PAYROLL_DETAIL')
ON CONFLICT DO NOTHING;

-- The acting application role for the current transaction ('' when not set).
CREATE OR REPLACE FUNCTION tau_app_role() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.role', true), ''), '');
$$;

-- TRUE when no application role is set (trusted system context) or the role holds the permission.
CREATE OR REPLACE FUNCTION tau_has_permission(p_permission TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT tau_app_role() = ''
      OR EXISTS (
           SELECT 1 FROM tau_role_permissions rp
           WHERE rp.role = tau_app_role() AND rp.permission = p_permission
         );
$$;

-- ---------------------------------------------------------------------------
-- Row-level security on payroll detail
-- ---------------------------------------------------------------------------

ALTER TABLE workers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers             FORCE  ROW LEVEL SECURITY;
ALTER TABLE payroll_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs        FORCE  ROW LEVEL SECURITY;
ALTER TABLE payroll_liabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_liabilities FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workers_payroll_detail             ON workers;
DROP POLICY IF EXISTS payroll_runs_payroll_detail        ON payroll_runs;
DROP POLICY IF EXISTS payroll_liabilities_payroll_detail ON payroll_liabilities;

CREATE POLICY workers_payroll_detail ON workers
  FOR ALL
  USING (tau_has_permission('VIEW_PAYROLL_DETAIL'))
  WITH CHECK (tau_has_permission('VIEW_PAYROLL_DETAIL'));

CREATE POLICY payroll_runs_payroll_detail ON payroll_runs
  FOR ALL
  USING (tau_has_permission('VIEW_PAYROLL_DETAIL'))
  WITH CHECK (tau_has_permission('VIEW_PAYROLL_DETAIL'));

CREATE POLICY payroll_liabilities_payroll_detail ON payroll_liabilities
  FOR ALL
  USING (tau_has_permission('VIEW_PAYROLL_DETAIL'))
  WITH CHECK (tau_has_permission('VIEW_PAYROLL_DETAIL'));

-- ---------------------------------------------------------------------------
-- audit_events: insert-only
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION tau_audit_events_immutable() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not permitted (immutable hash-chained log)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_no_update_delete ON audit_events;
CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION tau_audit_events_immutable();

DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events;
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION tau_audit_events_immutable();

-- Belt and braces for non-owner roles: no UPDATE/DELETE/TRUNCATE grants at all.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM PUBLIC;
