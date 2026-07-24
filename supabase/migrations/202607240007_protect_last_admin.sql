-- Prevent concurrent updates from removing the last active administrator of a tenant.
CREATE OR REPLACE FUNCTION mavo_protect_last_active_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  remaining_admins bigint;
BEGIN
  IF
    OLD.role = 'admin'
    AND OLD.is_active = true
    AND (
      TG_OP = 'DELETE'
      OR NEW.role <> 'admin'
      OR NEW.is_active = false
    )
  THEN
    -- Serializes only administrative demotions/deactivations of the same tenant.
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.organization_id, 0));

    SELECT COUNT(*)
      INTO remaining_admins
      FROM users
     WHERE organization_id = OLD.organization_id
       AND id <> OLD.id
       AND role = 'admin'
       AND is_active = true;

    IF remaining_admins = 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'last_active_admin';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_last_active_admin ON users;

CREATE TRIGGER protect_last_active_admin
BEFORE UPDATE OF role, is_active OR DELETE
ON users
FOR EACH ROW
EXECUTE FUNCTION mavo_protect_last_active_admin();
