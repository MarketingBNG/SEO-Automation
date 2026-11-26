-- Training moves to 12 levels (Basic, Intermediate, Advanced, Expert; 3 levels each) and a new
-- CPA-level US tax curriculum. The owner asked for everyone to start again from the basics, so every
-- trainee goes back to level 1. The change is recorded in the level history.
INSERT INTO training_level_history (email, from_level, to_level, reason)
SELECT email, level, 1, 'Reset to level 1 for the new 12-level curriculum (owner request)'
FROM training_profiles WHERE level <> 1;
UPDATE training_profiles SET level = 1, streak = 0 WHERE level <> 1 OR streak <> 0;
