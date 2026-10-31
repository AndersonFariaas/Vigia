-- Nome de exibição da conta. O cadastro exige; contas antigas ficam sem nome até serem atualizadas.
ALTER TABLE users ADD COLUMN nome TEXT;
