-- Fase 3: frota e máquinas.
-- VEICULO é medido em km (consumo em km/L); MAQUINA é medida em horas (consumo em L/h).

CREATE TABLE equipamentos (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id      INT UNSIGNED NOT NULL,
  tipo            ENUM('VEICULO','MAQUINA') NOT NULL,
  nome            VARCHAR(100) NOT NULL,
  placa           VARCHAR(10) NULL COMMENT 'Placa ou número de frota',
  marca           VARCHAR(60) NULL,
  modelo          VARCHAR(60) NULL,
  ano             SMALLINT UNSIGNED NULL,
  combustivel     ENUM('DIESEL','DIESEL_S10','GASOLINA','ETANOL','FLEX','GNV') NOT NULL DEFAULT 'DIESEL',
  leitura_atual   DECIMAL(12,1) NOT NULL DEFAULT 0 COMMENT 'Hodômetro (km) ou horímetro (h)',
  centro_custo_id INT UNSIGNED NULL,
  ativo           TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uk_eq_emp_id (empresa_id, id),
  UNIQUE KEY uk_eq_placa (empresa_id, placa),
  CONSTRAINT fk_eq_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id),
  CONSTRAINT fk_eq_cc      FOREIGN KEY (empresa_id, centro_custo_id) REFERENCES centros_custo (empresa_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE abastecimentos (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id      INT UNSIGNED NOT NULL,
  equipamento_id  INT UNSIGNED NOT NULL,
  data            DATE NOT NULL,
  leitura         DECIMAL(12,1) NOT NULL,
  litros          DECIMAL(10,3) NOT NULL,
  valor_total     DECIMAL(15,2) NOT NULL,
  tanque_cheio    TINYINT(1) NOT NULL DEFAULT 1,
  posto           VARCHAR(100) NULL,
  operador        VARCHAR(100) NULL,
  centro_custo_id INT UNSIGNED NULL COMMENT 'Obra onde o equipamento estava',
  observacao      VARCHAR(300) NULL,
  criado_por      INT UNSIGNED NULL,
  criado_em       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_ab_equip (empresa_id, equipamento_id, leitura),
  KEY ix_ab_data (empresa_id, data),
  CONSTRAINT ck_ab_litros CHECK (litros > 0 AND valor_total >= 0 AND leitura >= 0),
  CONSTRAINT fk_ab_equip FOREIGN KEY (empresa_id, equipamento_id) REFERENCES equipamentos (empresa_id, id),
  CONSTRAINT fk_ab_cc    FOREIGN KEY (empresa_id, centro_custo_id) REFERENCES centros_custo (empresa_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Plano de manutenção preventiva: a cada X km/horas e/ou a cada N dias.
CREATE TABLE planos_manutencao (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id        INT UNSIGNED NOT NULL,
  equipamento_id    INT UNSIGNED NOT NULL,
  descricao         VARCHAR(120) NOT NULL,
  intervalo_leitura DECIMAL(12,1) NULL,
  intervalo_dias    INT UNSIGNED NULL,
  ultima_leitura    DECIMAL(12,1) NULL,
  ultima_data       DATE NULL,
  ativo             TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uk_pm_emp_id (empresa_id, id),
  CONSTRAINT fk_pm_equip FOREIGN KEY (empresa_id, equipamento_id) REFERENCES equipamentos (empresa_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE manutencoes (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id      INT UNSIGNED NOT NULL,
  equipamento_id  INT UNSIGNED NOT NULL,
  plano_id        INT UNSIGNED NULL,
  tipo            ENUM('PREVENTIVA','CORRETIVA') NOT NULL,
  descricao       VARCHAR(200) NOT NULL,
  data            DATE NOT NULL,
  leitura         DECIMAL(12,1) NULL,
  valor           DECIMAL(15,2) NOT NULL DEFAULT 0,
  oficina         VARCHAR(100) NULL,
  observacao      VARCHAR(300) NULL,
  UNIQUE KEY uk_mn_emp_id (empresa_id, id),
  KEY ix_mn_equip (empresa_id, equipamento_id, data),
  CONSTRAINT fk_mn_equip FOREIGN KEY (empresa_id, equipamento_id) REFERENCES equipamentos (empresa_id, id),
  CONSTRAINT fk_mn_plano FOREIGN KEY (empresa_id, plano_id) REFERENCES planos_manutencao (empresa_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
