-- Fase 5: conta as tentativas de envio. Um alerta com falha volta a 'pendente' até o limite.
ALTER TABLE alerts ADD COLUMN send_attempts INTEGER NOT NULL DEFAULT 0;
