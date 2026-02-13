CREATE TABLE `hosts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `type` text DEFAULT 'proxy' NOT NULL,
  `group_id` integer REFERENCES `host_groups`(`id`) ON DELETE set null,
  `domains` text NOT NULL,
  `enabled` integer DEFAULT true NOT NULL,
  `ssl_type` text DEFAULT 'none' NOT NULL,
  `ssl_force_https` integer DEFAULT false NOT NULL,
  `ssl_cert_path` text,
  `ssl_key_path` text,
  `upstreams` text DEFAULT '[]' NOT NULL,
  `balance_method` text DEFAULT 'round_robin' NOT NULL,
  `locations` text DEFAULT '[]',
  `hsts` integer DEFAULT true NOT NULL,
  `http2` integer DEFAULT true NOT NULL,
  `static_dir` text,
  `cache_expires` text,
  `forward_scheme` text,
  `forward_domain` text,
  `forward_path` text DEFAULT '/',
  `preserve_path` integer DEFAULT true NOT NULL,
  `status_code` integer DEFAULT 301,
  `incoming_port` integer,
  `protocol` text,
  `webhook_url` text,
  `advanced_yaml` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE TABLE `host_labels` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `color` text NOT NULL,
  `created_at` integer NOT NULL
);

CREATE TABLE `host_label_assignments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `host_id` integer NOT NULL REFERENCES `hosts`(`id`) ON DELETE cascade,
  `label_id` integer NOT NULL REFERENCES `host_labels`(`id`) ON DELETE cascade
);

INSERT INTO `hosts` (
  `type`, `group_id`, `domains`, `enabled`,
  `ssl_type`, `ssl_force_https`, `ssl_cert_path`, `ssl_key_path`,
  `upstreams`, `balance_method`, `locations`, `hsts`, `http2`,
  `webhook_url`, `advanced_yaml`, `created_at`, `updated_at`
)
SELECT
  'proxy', `group_id`, `domains`, `enabled`,
  `ssl_type`, `ssl_force_https`, `ssl_cert_path`, `ssl_key_path`,
  `upstreams`, `balance_method`, `locations`, `hsts`, `http2`,
  `webhook_url`, `advanced_yaml`, `created_at`, `updated_at`
FROM `proxy_hosts`;

INSERT INTO `hosts` (
  `type`, `group_id`, `domains`, `enabled`,
  `ssl_type`, `forward_scheme`, `forward_domain`, `forward_path`,
  `preserve_path`, `status_code`, `created_at`, `updated_at`
)
SELECT
  'redirect', `group_id`, `domains`, `enabled`,
  `ssl_type`, `forward_scheme`, `forward_domain`, `forward_path`,
  `preserve_path`, `status_code`, `created_at`, `created_at`
FROM `redirections`;

INSERT INTO `hosts` (
  `type`, `group_id`, `domains`, `enabled`,
  `incoming_port`, `protocol`, `upstreams`, `balance_method`,
  `webhook_url`, `created_at`, `updated_at`
)
SELECT
  'stream', `group_id`, '[]', `enabled`,
  `incoming_port`, `protocol`, `upstreams`, `balance_method`,
  `webhook_url`, `created_at`, `created_at`
FROM `streams`;

DROP TABLE `proxy_hosts`;
DROP TABLE `redirections`;
DROP TABLE `streams`;
