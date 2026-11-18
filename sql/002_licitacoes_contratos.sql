-- Fase 2: licitações, documentos de habilitação, anexos, contratos,
-- planilha de execução, execuções, custos por item e notas fiscais.

CREATE TABLE licitacoes (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id      INT UNSIGNED NOT NULL,
  orgao_id        INT UNSIGNED NULL COMMENT 'Órgão licitante (cadastro de pessoas)',
  numero_processo VARCHAR(60) NOT NULL,
  modalidade      ENUM('PREGAO_ELETRONICO','PREGAO_PRESENCIAL','CONCORRENCIA','DISPENSA','INEXIGIBILIDADE','OUTRA') NOT NULL,
  objeto          TEXT NOT NULL,
  portal          VARCHAR(120) NULL,
  link            VARCHAR(500) NULL,
  data_abertura   DATETIME NULL,
  valor_estimado  DECIMAL(15,2) NULL,
  valor_proposta  DECIMAL(15,2) NULL,
  status          ENUM('PROSPECCAO','ANALISE','PROPOSTA','DISPUTA','HABILITACAO','HOMOLOGADA','CONTRATADA','PERDIDA','DESISTENCIA') NOT NULL DEFAULT 'PROSPECCAO',
  observacao      TEXT NULL,
  criado_em       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_lic_emp_id (empresa_id, id),
  KEY ix_lic_status (empresa_id, status, data_abertura),
  CONSTRAINT fk_lic_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id),
  CONSTRAINT fk_lic_orgao   FOREIGN KEY (empresa_id, orgao_id) REFERENCES pessoas (empresa_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Certidões e demais documentos de habilitação, com validade.
CREATE TABLE documentos_habilitacao (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT UNSIGNED NOT NULL,
  nome          VARCHAR(120) NOT NULL,
  tipo          ENUM('FISCAL','TRABALHISTA','JURIDICA','TECNICA','ECONOMICA','OUTRO') NOT NULL DEFAULT 'FISCAL',
  numero        VARCHAR(60) NULL,
  data_emissao  DATE NULL,
  data_validade DATE NULL,
  observacao    VARCHAR(300) NULL,
  UNIQUE KEY uk_doc_emp_id (empresa_id, id),
  KEY ix_doc_validade (empresa_id, data_validade),
  CONSTRAINT fk_doc_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Arquivos anexados (edital, certidões, contrato, nota). O conteúdo fica em disco,
-- com nome aleatório; aqui ficam o nome original e o hash.
CREATE TABLE arquivos (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT UNSIGNED NOT NULL,
  entidade      ENUM('LICITACAO','DOCUMENTO','CONTRATO','NOTA') NOT NULL,
  entidade_id   BIGINT UNSIGNED NOT NULL,
  nome_original VARCHAR(255) NOT NULL,
  caminho       VARCHAR(100) NOT NULL,
  mime          VARCHAR(100) NOT NULL,
  tamanho       INT UNSIGNED NOT NULL,
  sha256        CHAR(64) NOT NULL,
  criado_por    INT UNSIGNED NULL,
  criado_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_arq_entidade (empresa_id, entidade, entidade_id),
  CONSTRAINT fk_arq_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Cada contrato ganha um centro de custo próprio (tipo OBRA).
CREATE TABLE contratos (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id      INT UNSIGNED NOT NULL,
  licitacao_id    INT UNSIGNED NULL,
  cliente_id      INT UNSIGNED NOT NULL,
  centro_custo_id INT UNSIGNED NOT NULL,
  numero          VARCHAR(40) NOT NULL,
  objeto          TEXT NULL,
  data_assinatura DATE NULL,
  data_inicio     DATE NULL,
  data_fim        DATE NULL,
  valor_total     DECIMAL(15,2) NOT NULL DEFAULT 0,
  status          ENUM('ATIVO','SUSPENSO','CONCLUIDO','RESCINDIDO') NOT NULL DEFAULT 'ATIVO',
  criado_em       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_ct_emp_id (empresa_id, id),
  UNIQUE KEY uk_ct_numero (empresa_id, numero),
  CONSTRAINT fk_ct_empresa   FOREIGN KEY (empresa_id) REFERENCES empresas (id),
  CONSTRAINT fk_ct_licitacao FOREIGN KEY (empresa_id, licitacao_id) REFERENCES licitacoes (empresa_id, id),
  CONSTRAINT fk_ct_cliente   FOREIGN KEY (empresa_id, cliente_id) REFERENCES pessoas (empresa_id, id),
  CONSTRAINT fk_ct_cc        FOREIGN KEY (empresa_id, centro_custo_id) REFERENCES centros_custo (empresa_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Planilha de execução. Fases e itens na mesma tabela, em árvore (parent_id).
-- fase = 1: linha de agrupamento, sem quantidade; o valor é a soma dos filhos.
CREATE TABLE contrato_itens (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id     INT UNSIGNED NOT NULL,
  contrato_id    INT UNSIGNED NOT NULL,
  parent_id      BIGINT UNSIGNED NULL,
  ordem          INT UNSIGNED NOT NULL DEFAULT 0,
  codigo         VARCHAR(30) NOT NULL,
  descricao      VARCHAR(500) NOT NULL,
  unidade        VARCHAR(15) NULL,
  quantidade     DECIMAL(15,4) NULL,
  preco_unitario DECIMAL(15,4) NULL,
  valor_total    DECIMAL(15,2) NOT NULL DEFAULT 0,
  fase           TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uk_ci_emp_id (empresa_id, id),
  UNIQUE KEY uk_ci_codigo (contrato_id, codigo),
  CONSTRAINT fk_ci_contrato FOREIGN KEY (empresa_id, contrato_id) REFERENCES contratos (empresa_id, id),
  CONSTRAINT fk_ci_parent   FOREIGN KEY (empresa_id, parent_id) REFERENCES contrato_itens (empresa_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- O que foi executado de cada item. Aceita execução parcial.
CREATE TABLE execucoes (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id       INT UNSIGNED NOT NULL,
  contrato_id      INT UNSIGNED NOT NULL,
  contrato_item_id BIGINT UNSIGNED NOT NULL,
  data             DATE NOT NULL,
  quantidade       DECIMAL(15,4) NOT NULL,
  valor            DECIMAL(15,2) NOT NULL,
  observacao       VARCHAR(300) NULL,
  criado_por       INT UNSIGNED NULL,
  criado_em        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_ex_emp_id (empresa_id, id),
  KEY ix_ex_contrato (contrato_id, data),
  CONSTRAINT ck_ex_qtd CHECK (quantidade > 0),
  CONSTRAINT fk_ex_contrato FOREIGN KEY (empresa_id, contrato_id) REFERENCES contratos (empresa_id, id),
  CONSTRAINT fk_ex_item     FOREIGN KEY (empresa_id, contrato_item_id) REFERENCES contrato_itens (empresa_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Custo de cada item ou fase: liga uma conta a pagar ao item, com o valor apropriado.
-- Uma mesma conta a pagar pode ser dividida entre vários itens.
CREATE TABLE item_custos (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id       INT UNSIGNED NOT NULL,
  contrato_id      INT UNSIGNED NOT NULL,
  contrato_item_id BIGINT UNSIGNED NOT NULL,
  lancamento_id    BIGINT UNSIGNED NOT NULL,
  valor            DECIMAL(15,2) NOT NULL,
  criado_por       INT UNSIGNED NULL,
  criado_em        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_ic_item_lanc (contrato_item_id, lancamento_id),
  KEY ix_ic_lanc (empresa_id, lancamento_id),
  CONSTRAINT ck_ic_valor CHECK (valor > 0),
  CONSTRAINT fk_ic_contrato FOREIGN KEY (empresa_id, contrato_id) REFERENCES contratos (empresa_id, id),
  CONSTRAINT fk_ic_item     FOREIGN KEY (empresa_id, contrato_item_id) REFERENCES contrato_itens (empresa_id, id),
  CONSTRAINT fk_ic_lanc     FOREIGN KEY (empresa_id, lancamento_id) REFERENCES lancamentos (empresa_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Nota fiscal emitida fora do sistema e registrada aqui. Gera a conta a receber (valor líquido).
CREATE TABLE notas_fiscais (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id       INT UNSIGNED NOT NULL,
  contrato_id      INT UNSIGNED NOT NULL,
  numero           VARCHAR(20) NOT NULL,
  serie            VARCHAR(5) NOT NULL DEFAULT '',
  data_emissao     DATE NOT NULL,
  valor_bruto      DECIMAL(15,2) NOT NULL,
  iss              DECIMAL(15,2) NOT NULL DEFAULT 0,
  inss             DECIMAL(15,2) NOT NULL DEFAULT 0,
  irrf             DECIMAL(15,2) NOT NULL DEFAULT 0,
  outras_retencoes DECIMAL(15,2) NOT NULL DEFAULT 0,
  valor_liquido    DECIMAL(15,2) NOT NULL,
  lancamento_id    BIGINT UNSIGNED NULL,
  status           ENUM('EMITIDA','CANCELADA') NOT NULL DEFAULT 'EMITIDA',
  observacao       VARCHAR(300) NULL,
  criado_por       INT UNSIGNED NULL,
  criado_em        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_nf_emp_id (empresa_id, id),
  UNIQUE KEY uk_nf_numero (empresa_id, numero, serie),
  CONSTRAINT fk_nf_contrato FOREIGN KEY (empresa_id, contrato_id) REFERENCES contratos (empresa_id, id),
  CONSTRAINT fk_nf_lanc     FOREIGN KEY (empresa_id, lancamento_id) REFERENCES lancamentos (empresa_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Itens executados que entraram em cada nota (uma nota pode ter vários).
CREATE TABLE nota_fiscal_itens (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id  INT UNSIGNED NOT NULL,
  nota_id     BIGINT UNSIGNED NOT NULL,
  execucao_id BIGINT UNSIGNED NOT NULL,
  quantidade  DECIMAL(15,4) NOT NULL,
  valor       DECIMAL(15,2) NOT NULL,
  UNIQUE KEY uk_nfi (nota_id, execucao_id),
  CONSTRAINT fk_nfi_nota FOREIGN KEY (empresa_id, nota_id) REFERENCES notas_fiscais (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_nfi_exec FOREIGN KEY (empresa_id, execucao_id) REFERENCES execucoes (empresa_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
