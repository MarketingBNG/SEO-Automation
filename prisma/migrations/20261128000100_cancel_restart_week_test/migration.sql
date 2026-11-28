-- Owner: no test in the restart week. Remove Saturday 28 Nov's tests that were not taken yet (a test
-- already submitted stays on record). Training starts again on Monday 30 Nov.
DELETE FROM training_tests WHERE day = '2026-11-28' AND status IN ('open', 'marking');
