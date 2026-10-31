-- Fase 4 (LGPD): registro do aceite dos termos e da data em que foi dado.
ALTER TABLE users ADD COLUMN termos_versao TEXT;
ALTER TABLE users ADD COLUMN termos_aceitos_em TEXT;
