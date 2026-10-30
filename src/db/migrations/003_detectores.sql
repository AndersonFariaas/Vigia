-- Fase 2: sinais de risco de cada leitura (formulários, scripts, certificado e riscos ativos).
-- O JSON guarda o estado da página; os alertas só disparam quando um risco é novo em relação a ele.
ALTER TABLE snapshots ADD COLUMN signals TEXT NOT NULL DEFAULT '{}';
