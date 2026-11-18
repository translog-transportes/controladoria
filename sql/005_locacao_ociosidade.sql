-- Fase 4: locação de equipamentos para terceiros e acompanhamento de ociosidade da frota.

-- Quanto o equipamento pode gerar por dia. Base do cálculo da receita perdida nos dias parados.
ALTER TABLE equipamentos
  ADD COLUMN receita_dia DECIMAL(12,2) NULL COMMENT 'Receita potencial por dia (diária de referência)' AFTER centro_custo_id;

-- Locação de um equipamento para um cliente, em um endereço e período.
-- RESERVADA: só ocupa o calendário. CONFIRMADA: gerou a conta a receber.
-- CONCLUIDA: equipamento devolvido (e horas excedentes apuradas). CANCELADA: libera o calendário.
CREATE TABLE locacoes (
  id                      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id              INT UNSIGNED NOT NULL,
  numero                  INT UNSIGNED NOT NULL COMMENT 'Sequencial por empresa',
  cliente_id              INT UNSIGNED NOT NULL,
  equipamento_id          INT UNSIGNED NOT NULL,
  status                  ENUM('RESERVADA','CONFIRMADA','CONCLUIDA','CANCELADA') NOT NULL DEFAULT 'RESERVADA',
  data_inicio             DATE NOT NULL,
  data_fim                DATE NOT NULL,
  endereco                VARCHAR(200) NOT NULL COMMENT 'Endereço da obra onde o equipamento vai trabalhar',
  cidade                  VARCHAR(80) NULL,
  uf                      CHAR(2) NULL,
  cliente_endereco        VARCHAR(200) NULL COMMENT 'Endereço do locatário, para o contrato',
  responsavel             VARCHAR(120) NULL COMMENT 'Contato do cliente na obra',
  telefone                VARCHAR(30) NULL,
  dias_cobrados           INT UNSIGNED NOT NULL,
  valor_diaria            DECIMAL(12,2) NOT NULL,
  valor_deslocamento      DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Mobilização e desmobilização',
  com_operador            TINYINT(1) NOT NULL DEFAULT 0,
  valor_operador_dia      DECIMAL(12,2) NOT NULL DEFAULT 0,
  franquia_horas_dia      DECIMAL(5,1) NULL COMMENT 'Horas incluídas em cada diária',
  valor_hora_excedente    DECIMAL(12,2) NULL,
  combustivel             ENUM('LOCATARIO','INCLUSO','COBRADO') NOT NULL DEFAULT 'LOCATARIO',
  valor_combustivel       DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Só quando o combustível é cobrado à parte',
  caucao                  DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Garantia; não entra no total',
  desconto                DECIMAL(12,2) NOT NULL DEFAULT 0,
  valor_total             DECIMAL(15,2) NOT NULL,
  data_vencimento         DATE NULL,
  lancamento_id           BIGINT UNSIGNED NULL COMMENT 'Conta a receber da locação',
  leitura_inicio          DECIMAL(12,1) NULL COMMENT 'Horímetro/hodômetro na entrega',
  leitura_fim             DECIMAL(12,1) NULL COMMENT 'Horímetro/hodômetro na devolução',
  horas_excedentes        DECIMAL(10,1) NULL,
  valor_excedente         DECIMAL(15,2) NULL,
  lancamento_excedente_id BIGINT UNSIGNED NULL COMMENT 'Conta a receber das horas excedentes',
  observacao              VARCHAR(2000) NULL COMMENT 'Condições especiais, impressas no contrato',
  criado_por              INT UNSIGNED NULL,
  criado_em               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_loc_emp_id (empresa_id, id),
  UNIQUE KEY uk_loc_numero (empresa_id, numero),
  KEY ix_loc_equip (empresa_id, equipamento_id, data_inicio, data_fim),
  KEY ix_loc_periodo (empresa_id, data_inicio, data_fim),
  CONSTRAINT ck_loc_datas CHECK (data_fim >= data_inicio),
  CONSTRAINT ck_loc_valores CHECK (dias_cobrados > 0 AND valor_diaria >= 0 AND valor_deslocamento >= 0 AND valor_operador_dia >= 0
                                   AND valor_combustivel >= 0 AND caucao >= 0 AND desconto >= 0 AND valor_total >= 0),
  CONSTRAINT fk_loc_cliente FOREIGN KEY (empresa_id, cliente_id) REFERENCES pessoas (empresa_id, id),
  CONSTRAINT fk_loc_equip   FOREIGN KEY (empresa_id, equipamento_id) REFERENCES equipamentos (empresa_id, id),
  CONSTRAINT fk_loc_lanc    FOREIGN KEY (empresa_id, lancamento_id) REFERENCES lancamentos (empresa_id, id),
  CONSTRAINT fk_loc_lanc_ex FOREIGN KEY (empresa_id, lancamento_excedente_id) REFERENCES lancamentos (empresa_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Apontamento diário: o que cada equipamento fez no dia (dias locados vêm de "locacoes").
-- TRABALHANDO = em obra própria; PARADO = sem serviço (dia perdido); MANUTENCAO; FOLGA = feriado/dia não útil.
CREATE TABLE apontamentos (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id      INT UNSIGNED NOT NULL,
  equipamento_id  INT UNSIGNED NOT NULL,
  data            DATE NOT NULL,
  situacao        ENUM('TRABALHANDO','PARADO','MANUTENCAO','FOLGA') NOT NULL,
  centro_custo_id INT UNSIGNED NULL COMMENT 'Obra própria onde trabalhou',
  horas           DECIMAL(4,1) NULL,
  observacao      VARCHAR(200) NULL,
  criado_por      INT UNSIGNED NULL,
  criado_em       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_ap_dia (empresa_id, equipamento_id, data),
  KEY ix_ap_data (empresa_id, data),
  CONSTRAINT ck_ap_horas CHECK (horas IS NULL OR (horas >= 0 AND horas <= 24)),
  CONSTRAINT fk_ap_equip FOREIGN KEY (empresa_id, equipamento_id) REFERENCES equipamentos (empresa_id, id),
  CONSTRAINT fk_ap_cc    FOREIGN KEY (empresa_id, centro_custo_id) REFERENCES centros_custo (empresa_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
