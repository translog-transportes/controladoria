-- Liga cada abastecimento à conta a pagar que o pagou (ex.: nota quinzenal do posto).
-- Uma conta a pagar pode cobrir vários abastecimentos, de várias placas.
ALTER TABLE abastecimentos
  ADD COLUMN lancamento_id BIGINT UNSIGNED NULL AFTER centro_custo_id,
  ADD KEY ix_ab_lanc (empresa_id, lancamento_id),
  ADD CONSTRAINT fk_ab_lanc FOREIGN KEY (empresa_id, lancamento_id) REFERENCES lancamentos (empresa_id, id);
