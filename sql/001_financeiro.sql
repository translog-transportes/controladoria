-- Fase 1: base multiempresa + financeiro
-- Toda tabela de negócio tem empresa_id. As chaves estrangeiras são compostas
-- (empresa_id, id), então o próprio banco impede que um registro de uma
-- empresa aponte para um cadastro de outra.

CREATE TABLE empresas (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  razao_social  VARCHAR(150) NOT NULL,
  nome_fantasia VARCHAR(150) NULL,
  cnpj          CHAR(14) NOT NULL,
  ativo         TINYINT(1) NOT NULL DEFAULT 1,
  criado_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_empresas_cnpj (cnpj)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE usuarios (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome       VARCHAR(120) NOT NULL,
  email      VARCHAR(160) NOT NULL,
  senha_hash VARCHAR(100) NOT NULL,
  ativo      TINYINT(1) NOT NULL DEFAULT 1,
  -- Dono do sistema: cria e desativa empresas (clientes). Não enxerga os dados delas.
  super_admin       TINYINT(1) NOT NULL DEFAULT 0,
  -- Sobe a cada logout ou troca de senha: invalida todos os tokens antigos.
  token_versao      INT UNSIGNED NOT NULL DEFAULT 0,
  tentativas_falhas SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  bloqueado_ate     DATETIME NULL,
  ultimo_login      DATETIME NULL,
  criado_em  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_usuarios_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Perfis de acesso de cada empresa. "permissoes" é uma lista JSON,
-- por exemplo ["financeiro.ver","financeiro.editar"]; ["*"] libera tudo.
CREATE TABLE perfis (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT UNSIGNED NOT NULL,
  nome       VARCHAR(60) NOT NULL,
  permissoes JSON NOT NULL,
  sistema    TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = Administrador, não pode ser alterado nem excluído',
  UNIQUE KEY uk_perfis_emp_id (empresa_id, id),
  UNIQUE KEY uk_perfis_nome (empresa_id, nome),
  CONSTRAINT fk_perfis_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Um usuário pode acessar várias empresas, com um perfil em cada uma.
CREATE TABLE usuario_empresas (
  usuario_id INT UNSIGNED NOT NULL,
  empresa_id INT UNSIGNED NOT NULL,
  perfil_id  INT UNSIGNED NOT NULL,
  PRIMARY KEY (usuario_id, empresa_id),
  CONSTRAINT fk_ue_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE,
  CONSTRAINT fk_ue_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id) ON DELETE CASCADE,
  CONSTRAINT fk_ue_perfil  FOREIGN KEY (empresa_id, perfil_id) REFERENCES perfis (empresa_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Trilha de auditoria: logins e toda gravação feita pela API.
CREATE TABLE auditoria (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT UNSIGNED NULL,
  usuario_id INT UNSIGNED NULL,
  acao       VARCHAR(20) NOT NULL COMMENT 'POST, PUT, DELETE, LOGIN, LOGIN_FALHA, LOGOUT',
  rota       VARCHAR(255) NOT NULL,
  status     SMALLINT UNSIGNED NOT NULL,
  dados      TEXT NULL COMMENT 'Corpo da requisição, sem senhas',
  ip         VARCHAR(45) NULL,
  criado_em  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_auditoria_empresa (empresa_id, criado_em),
  KEY ix_auditoria_usuario (usuario_id, criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Clientes (órgãos públicos, contratantes) e fornecedores.
CREATE TABLE pessoas (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT UNSIGNED NOT NULL,
  tipo       ENUM('CLIENTE','FORNECEDOR','AMBOS') NOT NULL,
  nome       VARCHAR(150) NOT NULL,
  documento  VARCHAR(14) NULL COMMENT 'CPF ou CNPJ, só números',
  email      VARCHAR(160) NULL,
  telefone   VARCHAR(30) NULL,
  cidade     VARCHAR(80) NULL,
  uf         CHAR(2) NULL,
  ativo      TINYINT(1) NOT NULL DEFAULT 1,
  criado_em  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_pessoas_emp_id (empresa_id, id),
  UNIQUE KEY uk_pessoas_doc (empresa_id, documento),
  KEY ix_pessoas_nome (empresa_id, nome),
  CONSTRAINT fk_pessoas_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Plano de contas (categorias de receita e despesa), em árvore.
CREATE TABLE categorias (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT UNSIGNED NOT NULL,
  parent_id  INT UNSIGNED NULL,
  codigo     VARCHAR(20) NOT NULL,
  nome       VARCHAR(120) NOT NULL,
  tipo       ENUM('RECEITA','DESPESA') NOT NULL,
  grupo_dre  ENUM('RECEITA_BRUTA','DEDUCOES','CUSTO_DIRETO','DESPESA_OPERACIONAL','RESULTADO_FINANCEIRO') NOT NULL,
  ativo      TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uk_categorias_emp_id (empresa_id, id),
  UNIQUE KEY uk_categorias_codigo (empresa_id, codigo),
  CONSTRAINT fk_categorias_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id),
  CONSTRAINT fk_categorias_parent FOREIGN KEY (empresa_id, parent_id) REFERENCES categorias (empresa_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Centros de custo. Cada obra/contrato será um centro de custo do tipo OBRA
-- (as fases 2 e 3 ligam contratos e equipamentos aqui).
CREATE TABLE centros_custo (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT UNSIGNED NOT NULL,
  codigo     VARCHAR(20) NOT NULL,
  nome       VARCHAR(120) NOT NULL,
  tipo       ENUM('OBRA','ADMINISTRATIVO','EQUIPAMENTO') NOT NULL DEFAULT 'OBRA',
  ativo      TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uk_cc_emp_id (empresa_id, id),
  UNIQUE KEY uk_cc_codigo (empresa_id, codigo),
  CONSTRAINT fk_cc_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE contas_bancarias (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT UNSIGNED NOT NULL,
  nome          VARCHAR(80) NOT NULL,
  banco         VARCHAR(60) NULL,
  agencia       VARCHAR(10) NULL,
  conta         VARCHAR(20) NULL,
  saldo_inicial DECIMAL(15,2) NOT NULL DEFAULT 0,
  ativo         TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uk_cb_emp_id (empresa_id, id),
  UNIQUE KEY uk_cb_nome (empresa_id, nome),
  CONSTRAINT fk_cb_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Contas a pagar e a receber. Cada parcela é uma linha.
CREATE TABLE lancamentos (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id       INT UNSIGNED NOT NULL,
  tipo             ENUM('PAGAR','RECEBER') NOT NULL,
  pessoa_id        INT UNSIGNED NOT NULL,
  categoria_id     INT UNSIGNED NOT NULL,
  centro_custo_id  INT UNSIGNED NULL,
  descricao        VARCHAR(200) NOT NULL,
  documento        VARCHAR(40) NULL COMMENT 'Nº da nota, boleto, empenho etc.',
  data_emissao     DATE NULL,
  data_competencia DATE NOT NULL,
  data_vencimento  DATE NOT NULL,
  valor            DECIMAL(15,2) NOT NULL,
  valor_baixado    DECIMAL(15,2) NOT NULL DEFAULT 0,
  status           ENUM('ABERTO','PARCIAL','QUITADO','CANCELADO') NOT NULL DEFAULT 'ABERTO',
  parcela          SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  total_parcelas   SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  grupo_parcelas   CHAR(36) NULL COMMENT 'Mesmo valor em todas as parcelas de um lançamento',
  observacao       TEXT NULL,
  criado_por       INT UNSIGNED NULL,
  criado_em        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_lanc_emp_id (empresa_id, id),
  KEY ix_lanc_venc (empresa_id, tipo, status, data_vencimento),
  KEY ix_lanc_comp (empresa_id, data_competencia),
  KEY ix_lanc_grupo (grupo_parcelas),
  CONSTRAINT ck_lanc_valor CHECK (valor > 0),
  CONSTRAINT ck_lanc_baixado CHECK (valor_baixado >= 0 AND valor_baixado <= valor),
  CONSTRAINT fk_lanc_empresa   FOREIGN KEY (empresa_id) REFERENCES empresas (id),
  CONSTRAINT fk_lanc_pessoa    FOREIGN KEY (empresa_id, pessoa_id) REFERENCES pessoas (empresa_id, id),
  CONSTRAINT fk_lanc_categoria FOREIGN KEY (empresa_id, categoria_id) REFERENCES categorias (empresa_id, id),
  CONSTRAINT fk_lanc_cc        FOREIGN KEY (empresa_id, centro_custo_id) REFERENCES centros_custo (empresa_id, id),
  CONSTRAINT fk_lanc_usuario   FOREIGN KEY (criado_por) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Baixas (pagamentos e recebimentos). Um lançamento pode ter várias baixas parciais.
-- valor = principal quitado; o dinheiro que passou no banco é valor + juros + multa - desconto.
CREATE TABLE baixas (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id        INT UNSIGNED NOT NULL,
  lancamento_id     BIGINT UNSIGNED NOT NULL,
  conta_bancaria_id INT UNSIGNED NOT NULL,
  data_baixa        DATE NOT NULL,
  valor             DECIMAL(15,2) NOT NULL,
  juros             DECIMAL(15,2) NOT NULL DEFAULT 0,
  multa             DECIMAL(15,2) NOT NULL DEFAULT 0,
  desconto          DECIMAL(15,2) NOT NULL DEFAULT 0,
  valor_movimento   DECIMAL(15,2) AS (valor + juros + multa - desconto) STORED,
  observacao        VARCHAR(200) NULL,
  criado_por        INT UNSIGNED NULL,
  criado_em         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_baixas_data (empresa_id, data_baixa),
  KEY ix_baixas_conta (empresa_id, conta_bancaria_id, data_baixa),
  CONSTRAINT ck_baixas_valor CHECK (valor > 0 AND juros >= 0 AND multa >= 0 AND desconto >= 0),
  CONSTRAINT fk_baixas_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id),
  CONSTRAINT fk_baixas_lanc    FOREIGN KEY (empresa_id, lancamento_id) REFERENCES lancamentos (empresa_id, id),
  CONSTRAINT fk_baixas_conta   FOREIGN KEY (empresa_id, conta_bancaria_id) REFERENCES contas_bancarias (empresa_id, id),
  CONSTRAINT fk_baixas_usuario FOREIGN KEY (criado_por) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
