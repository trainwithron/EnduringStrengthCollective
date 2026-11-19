-- Undo step 206: removes the machines and their exercise lists (the exercises themselves stay in the library; a printed machine QR code then says it is not valid).
drop table if exists public.gym_machine_exercises;
drop table if exists public.gym_machines;
