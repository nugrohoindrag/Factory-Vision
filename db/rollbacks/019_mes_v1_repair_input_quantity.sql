-- Rollback 019. The repair only ever raised input_quantity to what the
-- dispositions already proved had entered the process; restoring the broken
-- values would mean re-introducing negative WIP, and the original figures were
-- never recorded anywhere to restore from. This is deliberately a no-op.
SELECT 'rollback 019 sengaja tidak mengembalikan nilai yang rusak' AS note;
