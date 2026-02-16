-- Step 1: Add new column for stream ports
ALTER TABLE `hosts` ADD COLUMN `stream_ports` text DEFAULT '[]';
--> statement-breakpoint

-- Step 2: Migrate existing data into locations-based format
-- For proxy hosts: move host-level upstreams/balanceMethod into a default location if no locations exist
UPDATE `hosts` SET `locations` = json_array(
  json_object(
    'path', '/',
    'matchType', 'prefix',
    'type', 'proxy',
    'upstreams', json(`upstreams`),
    'balanceMethod', `balance_method`,
    'staticDir', '',
    'cacheExpires', '',
    'forwardScheme', 'https',
    'forwardDomain', '',
    'forwardPath', '/',
    'preservePath', json('true'),
    'statusCode', 301,
    'headers', json_object(),
    'accessListId', null
  )
)
WHERE `type` = 'proxy'
  AND (`locations` IS NULL OR `locations` = '[]' OR `locations` = 'null')
  AND `upstreams` IS NOT NULL AND `upstreams` != '[]';
--> statement-breakpoint

-- For proxy hosts WITH existing locations: add missing fields to each location
-- (SQLite doesn't have great JSON array iteration, so we handle this in init-db.mjs)

-- For static hosts: convert to a single static location
UPDATE `hosts` SET `locations` = json_array(
  json_object(
    'path', '/',
    'matchType', 'prefix',
    'type', 'static',
    'upstreams', json('[]'),
    'balanceMethod', 'round_robin',
    'staticDir', COALESCE(`static_dir`, ''),
    'cacheExpires', COALESCE(`cache_expires`, ''),
    'forwardScheme', 'https',
    'forwardDomain', '',
    'forwardPath', '/',
    'preservePath', json('true'),
    'statusCode', 301,
    'headers', json_object(),
    'accessListId', null
  )
)
WHERE `type` = 'static';
--> statement-breakpoint

-- For redirect hosts: convert to a single redirect location
UPDATE `hosts` SET `locations` = json_array(
  json_object(
    'path', '/',
    'matchType', 'prefix',
    'type', 'redirect',
    'upstreams', json('[]'),
    'balanceMethod', 'round_robin',
    'staticDir', '',
    'cacheExpires', '',
    'forwardScheme', COALESCE(`forward_scheme`, 'https'),
    'forwardDomain', COALESCE(`forward_domain`, ''),
    'forwardPath', COALESCE(`forward_path`, '/'),
    'preservePath', CASE WHEN `preserve_path` THEN json('true') ELSE json('false') END,
    'statusCode', COALESCE(`status_code`, 301),
    'headers', json_object(),
    'accessListId', null
  )
)
WHERE `type` = 'redirect';
--> statement-breakpoint

-- For stream hosts: move to streamPorts, clear locations
UPDATE `hosts` SET
  `stream_ports` = json_array(
    json_object(
      'port', `incoming_port`,
      'protocol', COALESCE(`protocol`, 'tcp'),
      'upstreams', json(`upstreams`),
      'balanceMethod', COALESCE(`balance_method`, 'round_robin')
    )
  ),
  `locations` = '[]'
WHERE `type` = 'stream' AND `incoming_port` IS NOT NULL;
