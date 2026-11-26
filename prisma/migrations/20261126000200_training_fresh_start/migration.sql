-- Training fresh start (owner request, 26 Nov 2026): tests before 27 Nov were practice under the old
-- curriculum. They stay on record but no longer count (lib/trainingSchedule TRAINING_FRESH_START).
-- Close the old unfinished tests without creating missed-question repeats, and clear the old repeats,
-- so the first test of the new track asks only about what is taught now.
UPDATE training_tests SET status = 'missed', score = COALESCE(score, 0) WHERE day < '2026-11-27' AND status IN ('open', 'marking');
UPDATE training_misses SET cleared = true WHERE cleared = false;
